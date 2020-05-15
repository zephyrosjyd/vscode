/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/userDataSyncContextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import * as DOM from 'vs/base/browser/dom';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { UserDataSyncAccount } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncAccount';
import { IUserDataSyncEnablementService, IUserDataSyncService, SyncStatus, TURN_OFF_SYNC_COMMAND_ID, ALL_SYNC_RESOURCES, SyncResource, getSyncAreaLabel } from 'vs/platform/userDataSync/common/userDataSync';
import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { fromNow } from 'vs/base/common/date';
import { Button } from 'vs/base/browser/ui/button/button';
import { attachButtonStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { IListRenderer } from 'vs/base/browser/ui/list/list';
import { Gesture } from 'vs/base/browser/touch';
import { DisposableStore, Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { Dropdown } from 'vs/base/browser/ui/dropdown/dropdown';
import { IAnchor } from 'vs/base/browser/ui/contextview/contextview';
import { editorWidgetBackground, editorWidgetForeground, widgetShadow, inputBorder, inputForeground, inputBackground, editorBackground, contrastBorder } from 'vs/platform/theme/common/colorRegistry';

export interface IUserDataSyncManageDropdownOptions {
	userDataSyncAccount: UserDataSyncAccount
}

export class UserDataSyncContextView extends Dropdown {

	private readonly userDataSyncAccount: UserDataSyncAccount;

	constructor(
		container: HTMLElement,
		{ userDataSyncAccount }: IUserDataSyncManageDropdownOptions,
		@IContextViewService contextViewProvider: IContextViewService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ICommandService private readonly commandService: ICommandService,
		@IThemeService private readonly themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(container, { contextViewProvider });
		this.userDataSyncAccount = userDataSyncAccount;
	}

	protected getAnchor(): HTMLElement | IAnchor {
		const position = DOM.getDomNodePagePosition(this.element);

		return {
			x: position.left + position.width + 10, // center above the container
			y: position.top + position.height, // above status bar and beak
			width: position.width,
			height: position.height
		};
	}

	protected renderContents(parent: HTMLElement): IDisposable {
		const disposables = new DisposableStore();

		const container = DOM.append(parent, DOM.$('.sync-context-view'));
		disposables.add(attachStylerCallback(this.themeService, { widgetShadow, editorWidgetBackground, editorWidgetForeground, inputBackground, inputForeground, inputBorder, editorBackground, contrastBorder }, colors => {
			container.style.backgroundColor = colors.editorWidgetBackground ? colors.editorWidgetBackground.toString() : '';
			container.style.color = colors.editorWidgetForeground ? colors.editorWidgetForeground.toString() : '';
			container.style.boxShadow = colors.widgetShadow ? `0 0 8px ${colors.widgetShadow}` : '';
		}));

		DOM.append(container, DOM.$('h2.title')).textContent = localize('preferences sync on title', "Preferences Sync");

		const accountContainer = DOM.append(container, DOM.$('.sync-account-container'));

		const accountTitle = DOM.append(accountContainer, DOM.$('.sync-account-title'));
		accountTitle.textContent = localize('signed in account title', "Signed in with your {0} account", this.authenticationService.getDisplayName(this.userDataSyncAccount.authenticationProviderId));

		const accountInfo = DOM.append(accountContainer, DOM.$('.sync-account-info'));
		DOM.append(accountInfo, DOM.$(`.sync-account-icon.${Codicon.account.classNames}`));
		const accountDetails = DOM.append(accountInfo, DOM.$(`.sync-account-details`));

		const name = DOM.append(accountDetails, DOM.$(`.sync-account-name`));
		name.textContent = this.userDataSyncAccount.accountName;

		const status = DOM.append(accountDetails, DOM.$(`.sync-status`));
		status.textContent = this.getSyncStatusLabel();

		const syncConfigurationTitle = DOM.append(accountContainer, DOM.$('.sync-configuration-title'));
		syncConfigurationTitle.textContent = localize('syncing following', "Syncing following data:");

		const list = this._register(<WorkbenchList<SyncResource>>this.instantiationService.createInstance(WorkbenchList, 'ManageSync', accountContainer, {
			getHeight(): number { return 22; },
			getTemplateId(): string { return SyncResourceRenderer.ID; }
		}, [
			this.instantiationService.createInstance(SyncResourceRenderer),
		], {
			identityProvider: { getId: (element: SyncResource) => element },
			multipleSelectionSupport: false,
			accessibilityProvider: new SyncResourceAccessibilityProvider(this.userDataSyncEnablementService),
		}));

		list.splice(0, 0, ALL_SYNC_RESOURCES);
		list.layout(22 * ALL_SYNC_RESOURCES.length);

		const buttonContainer = DOM.append(container, DOM.$('.buttons-container'));

		const turnOffButton = this._register(new Button(buttonContainer));
		turnOffButton.label = localize('turn off sync', "Turn off");
		this._register(turnOffButton.onDidClick(_ => this.commandService.executeCommand(TURN_OFF_SYNC_COMMAND_ID)));
		this._register(attachButtonStyler(turnOffButton, this.themeService));

		return Disposable.None;
	}

	private getSyncStatusLabel(): string {
		if (!this.userDataSyncEnablementService.isEnabled()) {
			return localize('not sycing', "Not syncing");
		}
		if (this.userDataSyncService.status === SyncStatus.Syncing) {
			return localize('sync is on with syncing', "Syncing...");
		}
		if (this.userDataSyncService.lastSyncTime) {
			return localize('sync is on with time', "synced {0}", fromNow(this.userDataSyncService.lastSyncTime, true));
		}
		return '';
	}

	protected onEvent(e: any, activeElement: HTMLElement): void {
		// if (!DOM.isAncestor(activeElement, this.domNode)) {
		// 	super.onEvent(e, activeElement);
		// }
	}

}

interface SyncResourceTemplateData {
	name: HTMLElement;
	checkbox: HTMLInputElement;
	syncResource: SyncResource | null;
	disposable: DisposableStore;
}

class SyncResourceRenderer implements IListRenderer<SyncResource, SyncResourceTemplateData> {

	constructor(
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
	) {
	}

	static readonly ID = 'syncresources';

	get templateId() { return SyncResourceRenderer.ID; }

	renderTemplate(parent: HTMLElement): SyncResourceTemplateData {

		const container = DOM.append(parent, DOM.$('.sync-resource-container'));

		const checkbox = DOM.append(container, <HTMLInputElement>DOM.$('input'));
		checkbox.type = 'checkbox';
		checkbox.tabIndex = -1;
		Gesture.ignoreTarget(checkbox);

		const data: SyncResourceTemplateData = {
			name: DOM.append(container, DOM.$('span.name')),
			checkbox,
			syncResource: null,
			disposable: new DisposableStore()
		};

		data.disposable.add(DOM.addStandardDisposableListener(data.checkbox, 'change', () => {
			if (data.syncResource) {
				this.userDataSyncEnablementService.setResourceEnablement(data.syncResource, !this.userDataSyncEnablementService.isResourceEnabled(data.syncResource));
			}
		}));

		return data;
	}

	renderElement(syncResource: SyncResource, index: number, data: SyncResourceTemplateData): void {
		data.syncResource = syncResource;
		data.name.textContent = getSyncAreaLabel(syncResource);
		data.checkbox.checked = this.userDataSyncEnablementService.isResourceEnabled(syncResource);
	}

	disposeTemplate(templateData: SyncResourceTemplateData): void {
		templateData.disposable.dispose();
	}
}

class SyncResourceAccessibilityProvider implements IListAccessibilityProvider<SyncResource> {

	constructor(private readonly userDataSyncEnablementService: IUserDataSyncEnablementService) { }

	getWidgetAriaLabel(): string {
		return localize('syncresource', "Sync Resource");
	}

	getRole() {
		return 'checkbox';
	}

	isChecked(resource: SyncResource) {
		return this.userDataSyncEnablementService.isResourceEnabled(resource);
	}

	getAriaLabel(element: SyncResource): string | null {
		return getSyncAreaLabel(element);
	}
}
