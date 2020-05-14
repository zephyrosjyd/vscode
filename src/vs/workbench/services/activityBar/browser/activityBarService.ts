/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IBadge } from 'vs/workbench/services/activity/common/activity';
import { IDisposable } from 'vs/base/common/lifecycle';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { Dropdown } from 'vs/base/browser/ui/dropdown/dropdown';

export const IActivityBarService = createDecorator<IActivityBarService>('activityBarService');

export interface IActivityBarService {
	_serviceBrand: undefined;

	/**
	 * Show an activity in a viewlet.
	 */
	showActivity(viewletOrActionId: string, badge: IBadge, clazz?: string, priority?: number): IDisposable;

	/**
	 * Show context view for the given activity or viewlet
	 */
	showContextView(viewletOrActionId: string, contextView: SyncDescriptor<Dropdown>): IDisposable;

	/**
	 * Returns id of pinned view containers following the visual order.
	 */
	getPinnedViewContainerIds(): string[];

	/**
	 * Returns id of visible viewlets following the visual order.
	 */
	getVisibleViewContainerIds(): string[];

	/**
	 * Focuses the activity bar.
	 */
	focusActivityBar(): void;

}
