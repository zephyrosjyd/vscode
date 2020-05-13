/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
(function () {
	'use strict';

	const { ipcRenderer } = require('electron');

	// @ts-ignore
	window.vscode = {
		ipc: ipcRenderer
	};
}());
