import React from "react";
import type { AppSettingsController } from "../controllers/settings-controller";
import type { AppState } from "../../../workbench/state";
import { SettingsDialog } from "./dialog";
import type { SettingsGroup } from "./types";

type WorkbenchSettingsDialogFormState = {
  readonly ordinaryAgentSystemPrompt: string;
  readonly setOrdinaryAgentSystemPrompt: (value: string) => void;
};

type WorkbenchSettingsDialogPreferences = {
  readonly developerModeEnabled: boolean;
  readonly onDeveloperModeChange: (enabled: boolean) => void;
};

type WorkbenchSettingsDialogSavingState = {
  readonly ordinaryAgent?: boolean;
};

export type WorkbenchSettingsDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly app: Pick<AppState, "config">;
  readonly forms: WorkbenchSettingsDialogFormState;
  readonly preferences: WorkbenchSettingsDialogPreferences;
  readonly saving: WorkbenchSettingsDialogSavingState;
  readonly actions: AppSettingsController;
};

export function WorkbenchSettingsDialog(props: WorkbenchSettingsDialogProps): React.ReactElement | null {
  return (
    <SettingsDialog
      open={props.open}
      onClose={props.onClose}
      initialGroup={props.initialGroup}
      config={props.app.config}
      ordinaryAgentSystemPrompt={props.forms.ordinaryAgentSystemPrompt}
      setOrdinaryAgentSystemPrompt={props.forms.setOrdinaryAgentSystemPrompt}
      developerModeEnabled={props.preferences.developerModeEnabled}
      onDeveloperModeChange={props.preferences.onDeveloperModeChange}
      savingOrdinaryAgentPrompt={props.saving.ordinaryAgent}
      onSaveOrdinaryAgentSystemPrompt={props.actions.saveOrdinaryAgentSystemPrompt}
      onResetOrdinaryAgentSystemPrompt={props.actions.resetOrdinaryAgentSystemPrompt}
    />
  );
}
