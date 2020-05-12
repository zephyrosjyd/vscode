/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/userDataSyncView';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import * as DOM from 'vs/base/browser/dom';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { UserDataSyncAccounts } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncAccount';
import { IUserDataSyncEnablementService, IUserDataSyncService, SyncStatus, SHOW_SYNC_LOG_COMMAND_ID, MANAGE_SYNC_COMMAND_ID, TURN_OFF_SYNC_COMMAND_ID } from 'vs/platform/userDataSync/common/userDataSync';
import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { fromNow } from 'vs/base/common/date';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Button } from 'vs/base/browser/ui/button/button';
import { attachButtonStyler } from 'vs/platform/theme/common/styler';
import { Event } from 'vs/base/common/event';
import { timeout } from 'vs/base/common/async';
import { IAction, Action } from 'vs/base/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';

export class UserDataSyncViewPaneContainer extends ViewPaneContainer {

	private accountTemplate!: {
		container: HTMLElement,
		title: HTMLElement,
		icon: HTMLElement,
		name: HTMLElement,
		status: HTMLElement,
		turnOffButton: Button,
	};

	constructor(
		containerId: string,
		private readonly userDataSyncAccounts: UserDataSyncAccounts,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(containerId, { mergeViewWithContainerWhenSingleView: false }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);
	}

	getActions(): IAction[] {
		return [
			new Action('showSyncLog', localize('showLog', "Show Log"), Codicon.output.classNames, true, () => this.commandService.executeCommand(SHOW_SYNC_LOG_COMMAND_ID)),
			new Action('manageSync', localize('configure sync', "Configure..."), Codicon.settingsGear.classNames, true, () => this.commandService.executeCommand(MANAGE_SYNC_COMMAND_ID))
		];
	}

	create(parent: HTMLElement): void {
		DOM.addClass(parent, 'sync-view-container');
		this.renderAccount(parent);
		super.create(parent);
	}

	layout(dimension: DOM.Dimension): void {
		super.layout(new DOM.Dimension(dimension.width, dimension.height - 123));
	}

	private renderAccount(parent: HTMLElement): void {
		const container = DOM.append(parent, DOM.$('.sync-account-container'));
		container.style.height = '123px';
		const title = DOM.append(container, DOM.$('.sync-account-title'));
		const accountInfo = DOM.append(container, DOM.$('.sync-account-info'));

		const icon = DOM.append(accountInfo, DOM.$(`.sync-account-icon.${Codicon.account.classNames}`));
		const accountDetails = DOM.append(accountInfo, DOM.$(`.sync-account-details`));
		const name = DOM.append(accountDetails, DOM.$(`.sync-account-name`));
		const status = DOM.append(accountDetails, DOM.$(`.sync-status`));

		const turnOffButton = this._register(new Button(container));
		turnOffButton.label = localize('turn off', "Turn off Preferences Sync...");
		turnOffButton.enabled = false;
		this._register(turnOffButton.onDidClick(_ => this.commandService.executeCommand(TURN_OFF_SYNC_COMMAND_ID)));
		this._register(attachButtonStyler(turnOffButton, this.themeService));

		this.accountTemplate = {
			container, title, icon, name, status, turnOffButton
		};

		this.update();

		this._register(Event.any(this.userDataSyncAccounts.onDidChangeStatus, this.userDataSyncEnablementService.onDidChangeEnablement)(() => this.update()));
		this._register(Event.debounce(this.userDataSyncService.onDidChangeStatus, () => undefined, 100)(() => this.updateStatus()));
		this.autoUpdateStatus();
	}

	private update(): void {
		const activeAccount = this.userDataSyncAccounts.current;
		if (activeAccount) {
			if (this.userDataSyncEnablementService.isEnabled()) {
				this.accountTemplate.title.textContent = localize('account title', "Syncing to your {0} account", this.authenticationService.getDisplayName(activeAccount.authenticationProviderId));
				this.accountTemplate.name.textContent = activeAccount.accountName;
				this.accountTemplate.turnOffButton.enabled = true;
				this.updateStatus();
			}
		}
	}

	private updateStatus(): void {
		if (this.userDataSyncEnablementService.isEnabled()) {
			this.accountTemplate.status.textContent = this.getSyncStatusLabel();
		}
	}

	private async autoUpdateStatus(): Promise<void> {
		this.updateStatus();
		await timeout(1000 * 60 * 1);
		this.autoUpdateStatus();
	}

	private getSyncStatusLabel(): string {
		if (this.userDataSyncService.status === SyncStatus.Syncing) {
			return localize('sync is on with syncing', "Syncing...");
		}
		if (this.userDataSyncService.lastSyncTime) {
			return localize('sync is on with time', "synced {0}", fromNow(this.userDataSyncService.lastSyncTime, true));
		}
		return '';
	}

}
