import { isValidBookmarkIndex, calculateBookmarkIndex } from './bookmarkFormatHelper';
import { getSystemStaticInfo } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { SystemSignature, SignatureKind, SignatureGroup } from '@/hooks/Mapper/types';
import { SolarSystemRawType } from '@/hooks/Mapper/types/system';
import { SolarSystemConnection, TimeStatus, MassState, ShipSizeStatus } from '@/hooks/Mapper/types/connection';

jest.mock('@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic', () => ({
  getSystemStaticInfo: jest.fn(),
}));

const createMockSystem = (overrides: Partial<SolarSystemRawType> & { id: string }): SolarSystemRawType => ({
  position: { x: 0, y: 0 },
  description: null,
  labels: null,
  locked: false,
  tag: null,
  status: 0,
  name: null,
  temporary_name: null,
  linked_sig_eve_id: null,
  comments_count: null,
  system_static_info: {
    region_id: 0,
    constellation_id: 0,
    solar_system_id: 0,
    solar_system_name: '',
    solar_system_name_lc: '',
    constellation_name: '',
    region_name: '',
    system_class: 0,
    security: '',
    type_description: '',
    class_title: '',
    is_shattered: false,
    effect_name: '',
    effect_power: 0,
    statics: [],
    wandering: [],
    triglavian_invasion_status: '',
    sun_type_id: 0,
  },
  system_signatures: [],
  ...overrides,
});

const createMockConnection = (
  overrides: Partial<SolarSystemConnection> & { id: string; source: string; target: string },
): SolarSystemConnection => ({
  time_status: TimeStatus.reserved,
  mass_status: MassState.normal,
  ship_size_type: ShipSizeStatus.small,
  locked: false,
  ...overrides,
});

const createMockSignature = (overrides: Partial<SystemSignature> & { eve_id: string }): SystemSignature => ({
  kind: SignatureKind.CosmicSignature,
  name: '',
  group: SignatureGroup.Wormhole,
  type: '',
  ...overrides,
});

describe('bookmarkFormatHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidBookmarkIndex', () => {
    it('should validate standard numeric indexes', () => {
      expect(isValidBookmarkIndex('1')).toBe(true);
      expect(isValidBookmarkIndex('12')).toBe(true);
    });

    it('should validate letter-digit combinations with maximum 2 letters', () => {
      expect(isValidBookmarkIndex('A1')).toBe(true);
      expect(isValidBookmarkIndex('A11')).toBe(true);
      expect(isValidBookmarkIndex('AB1')).toBe(true);
      expect(isValidBookmarkIndex('ABC1')).toBe(false); // 3 letters is invalid
    });

    it('should validate single or double letters', () => {
      expect(isValidBookmarkIndex('A')).toBe(true);
      expect(isValidBookmarkIndex('AB')).toBe(true);
      expect(isValidBookmarkIndex('ABC')).toBe(false); // 3 letters is invalid
    });

    it('should handle custom separators correctly', () => {
      expect(isValidBookmarkIndex('A-1', '-')).toBe(true);
      expect(isValidBookmarkIndex('A-B-1', '-')).toBe(true);
      expect(isValidBookmarkIndex('Home-1', '-')).toBe(false); // 'Home' part is invalid
      expect(isValidBookmarkIndex('A-1', '')).toBe(false); // Invalid without separator due to hyphen
    });

    it('should reject non-standard label strings like Home or Danger', () => {
      expect(isValidBookmarkIndex('Home')).toBe(false);
      expect(isValidBookmarkIndex('Danger')).toBe(false);
      expect(isValidBookmarkIndex('HUB')).toBe(false);
    });
  });

  describe('calculateBookmarkIndex', () => {
    const mockSignatures: Record<string, SystemSignature[]> = {};

    it('should use a systems custom label or tag if standard', () => {
      (getSystemStaticInfo as jest.Mock).mockReturnValue({ solar_system_id: 30000142 });

      const systems: SolarSystemRawType[] = [
        createMockSystem({
          id: 'sys1',
          tag: 'A',
          labels: 'customLabel:A',
          temporary_name: 'sys-1',
        }),
      ];

      const result = calculateBookmarkIndex(mockSignatures, 'sys1', 'sys1', 'sig1', false, '-', systems, []);

      // Since the system itself is the start node and has a valid tag 'A', it should be treated as parent index
      expect(result.chained).toBe('A-1');
      expect(result.index).toBe(1);
    });

    it('should skip non-standard custom labels/tags during topology tracing', () => {
      (getSystemStaticInfo as jest.Mock).mockReturnValue({ solar_system_id: 30000142 });

      const systems: SolarSystemRawType[] = [
        createMockSystem({
          id: 'sys_parent',
          tag: 'A',
        }),
        createMockSystem({
          id: 'sys_child_1',
          tag: 'Home', // non-standard, should be ignored
        }),
        createMockSystem({
          id: 'sys_child_2',
          tag: '',
        }),
      ];

      const connections: SolarSystemConnection[] = [
        createMockConnection({
          id: 'conn1',
          source: 'sys_parent',
          target: 'sys_child_1',
        }),
        createMockConnection({
          id: 'conn2',
          source: 'sys_child_1',
          target: 'sys_child_2',
        }),
      ];

      const result = calculateBookmarkIndex(
        mockSignatures,
        'sys_child_2',
        'sys_child_2',
        'sig2',
        false,
        '-',
        systems,
        connections,
      );

      // sys_child_2 parent is sys_child_1. Since sys_child_1's tag 'Home' is non-standard,
      // it should continue searching upstream to sys_parent whose tag is 'A' (which is valid).
      // sys_child_1 is child 1 of sys_parent -> index is 1.
      // sys_child_2 is child 1 of sys_child_1 -> index is 1.
      // Since sys_child_1's own label 'Home' is skipped, the chain index at sys_child_1 resolves to 'A-1'.
      // Therefore, sys_child_2 should be resolved to 'A-1-1', and its signature's index is 'A-1-1-1'.
      expect(result.chained).toBe('A-1-1-1');
    });

    it('should correctly avoid collision with existing tags in local chain systems', () => {
      const systems: SolarSystemRawType[] = [
        createMockSystem({
          id: 'sys_parent',
          tag: 'B',
        }),
        createMockSystem({
          id: 'sys_child_1',
          tag: 'B-1',
        }),
        createMockSystem({
          id: 'sys_child_2',
          tag: '',
        }),
      ];

      const connections: SolarSystemConnection[] = [
        createMockConnection({
          id: 'conn1',
          source: 'sys_parent',
          target: 'sys_child_1',
        }),
        createMockConnection({
          id: 'conn2',
          source: 'sys_parent',
          target: 'sys_child_2',
        }),
      ];

      const result = calculateBookmarkIndex(
        mockSignatures,
        'sys_child_2',
        'sys_child_2',
        'sig2',
        false,
        '-',
        systems,
        connections,
      );

      // sys_child_2's parent is sys_parent ('B').
      // Sibling sys_child_1 already has tag 'B-1'.
      // So the generated candidate index 'B-1' collides with existing 'B-1' in the local chain systems.
      // It must increment to find the next available index 'B-2', and its signature's index is 'B-2-1'.
      expect(result.chained).toBe('B-2-1');
      expect(result.index).toBe(1);
    });

    it('should not collide with its own linked target system tag/label', () => {
      const systems: SolarSystemRawType[] = [
        createMockSystem({
          id: 'sys_parent',
          tag: 'B',
        }),
        createMockSystem({
          id: 'sys_child_1',
          tag: 'B-1',
          linked_sig_eve_id: 'sig1',
        }),
      ];

      const connections: SolarSystemConnection[] = [
        createMockConnection({
          id: 'conn1',
          source: 'sys_parent',
          target: 'sys_child_1',
        }),
      ];

      const result = calculateBookmarkIndex(
        mockSignatures,
        'sys_parent',
        'sys_parent',
        'sig1',
        false,
        '-',
        systems,
        connections,
      );

      // sys_child_1's tag 'B-1' should be excluded from collision check because it's linked to 'sig1'.
      // So the result should be 'B-1' and index 1 instead of incrementing to 'B-2'.
      expect(result.chained).toBe('B-1');
      expect(result.index).toBe(1);
    });

    it('should ignore unlinked/stale signatures when checking for collisions', () => {
      const systems: SolarSystemRawType[] = [
        createMockSystem({
          id: 'sys_parent',
          tag: 'B',
        }),
        createMockSystem({
          id: 'sys_child_1',
          tag: 'B-1',
          linked_sig_eve_id: 'sig1',
        }),
      ];

      const connections: SolarSystemConnection[] = [
        createMockConnection({
          id: 'conn1',
          source: 'sys_parent',
          target: 'sys_child_1',
        }),
      ];

      const signatures: Record<string, SystemSignature[]> = {
        sys_parent: [
          createMockSignature({
            eve_id: 'sig1',
            group: SignatureGroup.Wormhole,
            custom_info: JSON.stringify({
              bookmark_index: 1,
              bookmark_index_chained: 'B-1',
              bookmark_index_chained_letters: 'B-1',
            }),
            linked_system: {
              region_id: 0,
              constellation_id: 0,
              solar_system_id: 0,
              solar_system_name: '',
              solar_system_name_lc: '',
              constellation_name: '',
              region_name: '',
              system_class: 0,
              security: '',
              type_description: '',
              class_title: '',
              is_shattered: false,
              effect_name: '',
              effect_power: 0,
              statics: [],
              wandering: [],
              triglavian_invasion_status: '',
              sun_type_id: 0,
            },
          }),
          createMockSignature({
            eve_id: 'sig2',
            group: SignatureGroup.Wormhole,
            custom_info: JSON.stringify({
              bookmark_index: 2,
              bookmark_index_chained: 'B-2',
              bookmark_index_chained_letters: 'B-2',
            }),
          }),
        ],
      };

      const result = calculateBookmarkIndex(
        signatures,
        'sys_parent',
        'sys_parent',
        'sig3',
        false,
        '-',
        systems,
        connections,
      );

      // 'B-1' is taken by active child system sys_child_1.
      // 'B-2' should be free because 'sig2' is unlinked (even though it has stale B-2 bookmark info).
      // So the returned result should be 'B-2' and index 2.
      expect(result.chained).toBe('B-2');
      expect(result.index).toBe(2);
    });
  });
});
