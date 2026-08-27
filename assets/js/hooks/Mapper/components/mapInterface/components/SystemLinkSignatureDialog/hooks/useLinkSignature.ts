import { useCallback, useEffect, useRef, useState } from 'react';

import { handleAutoBookmark, applySystemAutoTags } from '@/hooks/Mapper/helpers/bookmarkFormatHelper.ts';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { CommandLinkSignatureToSystem, SignatureGroup, SystemSignature } from '@/hooks/Mapper/types';
import { OutCommand } from '@/hooks/Mapper/types/mapHandlers.ts';

export interface UseLinkSignatureProps {
  data: CommandLinkSignatureToSystem;
  targetSystemClassGroup: string | null;
}

export const useLinkSignature = ({ data, targetSystemClassGroup }: UseLinkSignatureProps) => {
  const {
    outCommand,
    data: { systemSignatures, systems, wormholesData, connections },
  } = useMapRootState();

  const ref = useRef({ outCommand });
  ref.current = { outCommand };

  const [userSettings, setUserSettings] = useState<any>(null);

  useEffect(() => {
    outCommand({ type: OutCommand.getUserSettings, data: null })
      .then((res: any) => setUserSettings(res?.user_settings))
      .catch((e: any) => console.warn('Failed to fetch user settings', e));
  }, [outCommand]);

  const handleLinkSignature = useCallback(
    async (signature: SystemSignature) => {
      const { outCommand } = ref.current;

      const sourceSystem = systems.find((s: any) => s.id === data.solar_system_source?.toString());
      const systemUuid = sourceSystem?.id || data.solar_system_source.toString();

      const targetSystem = systems.find((s: any) => s.id === data.solar_system_target?.toString());
      const targetSystemUuid = targetSystem?.id;
      const targetSolarSystemIdStr = data.solar_system_target?.toString();

      const signatureToLink = { ...signature, group: SignatureGroup.Wormhole };

      let currentSettings = userSettings;
      if (!currentSettings) {
        try {
          const res: any = await outCommand({ type: OutCommand.getUserSettings, data: null });
          currentSettings = res?.user_settings;
        } catch (e) {
          console.warn('Failed to fetch user settings', e);
        }
      }

      const { updatedSignature, shouldUpdate } = await handleAutoBookmark(
        signatureToLink,
        currentSettings,
        systemSignatures,
        systemUuid,
        data.solar_system_source.toString(),
        wormholesData,
        targetSystemClassGroup,
        targetSystemUuid,
        targetSolarSystemIdStr,
        systems,
        connections,
      );

      if (shouldUpdate) {
        await outCommand({
          type: OutCommand.updateSignatures,
          data: {
            system_id: `${data.solar_system_source}`,
            updated: [updatedSignature],
            removed: [],
            deleteTimeout: 0,
          },
        });
      }

      await outCommand({
        type: OutCommand.linkSignatureToSystem,
        data: {
          ...data,
          signature_eve_id: signature.eve_id,
        },
      });

      await applySystemAutoTags(updatedSignature, currentSettings, targetSystem, outCommand);
    },
    [data, userSettings, targetSystemClassGroup, systemSignatures, systems, wormholesData, connections],
  );

  return { handleLinkSignature };
};
