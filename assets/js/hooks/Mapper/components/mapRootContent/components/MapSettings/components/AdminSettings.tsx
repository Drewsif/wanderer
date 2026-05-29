import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toast } from 'primereact/toast';
import { callToastError, callToastSuccess, callToastWarn } from '@/hooks/Mapper/helpers';
import { OutCommand } from '@/hooks/Mapper/types';
import { ConfirmPopup } from 'primereact/confirmpopup';
import { useConfirmPopup } from '@/hooks/Mapper/hooks';
import { MapUserSettings, RemoteAdminSettingsResponse } from '@/hooks/Mapper/mapRootProvider/types.ts';
import { parseMapUserSettings } from '@/hooks/Mapper/components/helpers';
import fastDeepEqual from 'fast-deep-equal';
import { useDetectSettingsChanged } from '@/hooks/Mapper/components/hooks';
import { WdButton } from '@/hooks/Mapper/components/ui-kit';
import { useMapSettings } from '@/hooks/Mapper/components/mapRootContent/components/MapSettings/MapSettingsProvider.tsx';
import { UserSettingsRemoteList } from '@/hooks/Mapper/components/mapRootContent/components/MapSettings/constants.ts';

export const AdminSettings = () => {
  const {
    storedSettings: { getSettingsForExport },
    outCommand,
  } = useMapRootState();

  const settingsChanged = useDetectSettingsChanged();

  const [currentRemoteSettings, setCurrentRemoteSettings] = useState<MapUserSettings | null>(null);

  const { cfShow, cfHide, cfVisible, cfRef } = useConfirmPopup();
  const toast = useRef<Toast | null>(null);

  const { settings } = useMapSettings();

  const hasSettingsForExport = useMemo(() => !!getSettingsForExport(), [getSettingsForExport]);

  const refVars = useRef({ currentRemoteSettings, getSettingsForExport });
  refVars.current = { currentRemoteSettings, getSettingsForExport };

  useEffect(() => {
    const load = async () => {
      let res: RemoteAdminSettingsResponse | undefined;
      try {
        res = await outCommand({ type: OutCommand.getDefaultSettings, data: null });
      } catch (error) {
        // do nothing
      }

      if (!res || res.default_settings == null) {
        return;
      }

      setCurrentRemoteSettings(parseMapUserSettings(res.default_settings));
    };

    load();
  }, [outCommand]);

  const isDirty = useMemo(() => {
    const { currentRemoteSettings, getSettingsForExport } = refVars.current;
    const localCurrentStr = getSettingsForExport();
    if (!localCurrentStr) return false;

    const localCurrent = parseMapUserSettings(localCurrentStr);
    localCurrent.userSettings = UserSettingsRemoteList.reduce((acc, prop) => {
      if (settings[prop] !== undefined) {
        acc[prop] = settings[prop];
      }
      return acc;
    }, {} as any);

    return !fastDeepEqual(currentRemoteSettings, localCurrent);
    // eslint-disable-next-line
  }, [settingsChanged, currentRemoteSettings, settings]);

  const handleSync = useCallback(async () => {
    const settingsStr = getSettingsForExport();

    if (!settingsStr) {
      callToastWarn(toast.current, 'No settings to save');

      return;
    }

    const baseSettings = JSON.parse(settingsStr);
    baseSettings.userSettings = UserSettingsRemoteList.reduce((acc, prop) => {
      if (settings[prop] !== undefined) {
        acc[prop] = settings[prop];
      }
      return acc;
    }, {} as any);

    const settingsToSave = JSON.stringify(baseSettings);

    let response: { success: boolean } | undefined;

    try {
      response = await outCommand({
        type: OutCommand.saveDefaultSettings,
        data: { settings: settingsToSave },
      });
    } catch (err) {
      callToastError(toast.current, 'Something went wrong while saving settings');
      console.error('ERROR: ', err);
      return;
    }

    if (!response || !response.success) {
      callToastError(toast.current, 'Settings not saved - dont not why it');
      return;
    }

    setCurrentRemoteSettings(parseMapUserSettings(settingsToSave));

    callToastSuccess(toast.current, 'Settings saved successfully');
  }, [getSettingsForExport, outCommand, settings]);

  return (
    <div className="w-full h-full flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div>
          <WdButton
            // @ts-ignore
            ref={cfRef}
            onClick={cfShow}
            icon="pi pi-save"
            size="small"
            severity="danger"
            label="Save as Map Default"
            className="py-[4px]"
            disabled={!hasSettingsForExport || !isDirty}
          />
        </div>

        {!isDirty && <span className="text-red-500/70 text-[12px]">*Local and remote are identical.</span>}

        <span className="text-stone-500 text-[12px]">
          *Will save your current settings as the default for all new users of this map. This action will overwrite any
          existing default settings.
        </span>
      </div>

      <Toast ref={toast} />

      <ConfirmPopup
        target={cfRef.current}
        visible={cfVisible}
        onHide={cfHide}
        message="Your settings will overwrite default. Sure?."
        icon="pi pi-exclamation-triangle"
        accept={handleSync}
      />
    </div>
  );
};
