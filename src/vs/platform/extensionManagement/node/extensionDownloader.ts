/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tmpdir } from 'os';
import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService, IFileStat } from 'vs/platform/files/common/files';
import { IExtensionGalleryService, IGalleryExtension, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { URI } from 'vs/base/common/uri';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { joinPath } from 'vs/base/common/resources';
import { ExtensionIdentifierWithVersion, groupByExtension } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';
import * as semver from 'semver-umd';

const ExtensionIdVersionRegex = /^([^.]+\..+)-(\d+\.\d+\.\d+)$/;

export class ExtensionDownloadsCache extends Disposable {

	private readonly extensionsDownloadDir: URI = URI.file(tmpdir());
	private readonly cacheSize: number = 0;
	private readonly cleanUpPromise: Promise<void> = Promise.resolve();

	constructor(
		@IEnvironmentService environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		if (environmentService.extensionsDownloadPath) {
			this.extensionsDownloadDir = URI.file(environmentService.extensionsDownloadPath);
			this.cacheSize = 20;
			this.cleanUpPromise = this.cleanUp();
		}
	}

	async downloadExtension(extension: IGalleryExtension, operation: InstallOperation): Promise<URI> {
		await this.cleanUpPromise;
		const location = joinPath(this.extensionsDownloadDir, this.cacheSize ? this.getName(extension) : generateUuid());
		await this.download(extension, location, operation);
		return location;
	}

	async delete(location: URI): Promise<void> {
		// Delete immediately if caching is disabled
		if (!this.cacheSize) {
			await this.fileService.del(location);
		}
	}

	private async download(extension: IGalleryExtension, location: URI, operation: InstallOperation): Promise<void> {
		if (!await this.fileService.exists(location)) {
			await this.extensionGalleryService.download(extension, location, operation);
		}
	}

	private async cleanUp(): Promise<void> {
		try {
			if (!(await this.fileService.exists(this.extensionsDownloadDir))) {
				this.logService.trace('Extension VSIX downlads cache dir does not exist');
				return;
			}
			const folderStat = await this.fileService.resolve(this.extensionsDownloadDir);
			if (folderStat.children) {
				const toRemove: IFileStat[] = [];
				const allExtensions: { extensionIdentifierWithVersion: ExtensionIdentifierWithVersion, stat: IFileStat }[] = [];
				for (const stat of folderStat.children) {
					const extensionIdentifierWithVersion = this.parse(stat.name);
					if (extensionIdentifierWithVersion) {
						allExtensions.push({ extensionIdentifierWithVersion, stat });
					} else {
						toRemove.push(stat);
					}
				}
				const byExtension = groupByExtension(allExtensions, e => e.extensionIdentifierWithVersion.identifier);
				const distinctExtensions: IFileStat[] = [];
				for (const p of byExtension) {
					p.sort((a, b) => semver.rcompare(a.extensionIdentifierWithVersion.version, b.extensionIdentifierWithVersion.version));
					toRemove.push(...p.slice(1).map(e => e.stat));
					distinctExtensions.push(p[0].stat);
				}
				toRemove.push(...distinctExtensions.slice(0, Math.max(0, distinctExtensions.length - this.cacheSize)));
				await Promise.all(toRemove.map(stat => {
					this.logService.trace('Deleting vsix from backup', stat.resource.path);
					return this.fileService.del(stat.resource);
				}));
			}
		} catch (e) {
			this.logService.error(e);
		}
	}

	private getName(extension: IGalleryExtension): string {
		return new ExtensionIdentifierWithVersion(extension.identifier, extension.version).key().toLowerCase();
	}

	private parse(name: string): ExtensionIdentifierWithVersion | null {
		const matches = ExtensionIdVersionRegex.exec(name);
		return matches && matches[1] && matches[2] ? new ExtensionIdentifierWithVersion({ id: matches[1] }, matches[2]) : null;
	}
}
