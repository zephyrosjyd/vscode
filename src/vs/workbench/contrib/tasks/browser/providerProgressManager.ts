/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as Types from 'vs/base/common/types';
import * as TaskConfig from '../common/taskConfiguration';
import { TaskSet, Task, ContributedTask, ConfiguringTask, CustomTask, KeyedTaskIdentifier as NKeyedTaskIdentifier } from 'vs/workbench/contrib/tasks/common/tasks';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { TaskDefinitionRegistry } from 'vs/workbench/contrib/tasks/common/taskDefinitionRegistry';
import { IStringDictionary } from 'vs/base/common/collections';
import { IOutputChannel } from 'vs/workbench/contrib/output/common/output';
import { ITaskProvider, WorkspaceFolderTaskResult } from 'vs/workbench/contrib/tasks/common/taskService';
import { IWorkspace, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export function isWorkspaceFolder(folder: IWorkspace | IWorkspaceFolder): folder is IWorkspaceFolder {
	return 'uri' in folder;
}

export class TaskMap {
	private _store: Map<string, Task[]> = new Map();

	public forEach(callback: (value: Task[], folder: string) => void): void {
		this._store.forEach(callback);
	}

	private getKey(workspaceFolder: IWorkspace | IWorkspaceFolder | string): string {
		let key: string | undefined;
		if (Types.isString(workspaceFolder)) {
			key = workspaceFolder;
		} else {
			const uri: URI | null | undefined = isWorkspaceFolder(workspaceFolder) ? workspaceFolder.uri : workspaceFolder.configuration;
			key = uri ? uri.toString() : '';
		}
		return key;
	}

	public get(workspaceFolder: IWorkspace | IWorkspaceFolder | string): Task[] {
		const key = this.getKey(workspaceFolder);
		let result: Task[] | undefined = this._store.get(key);
		if (!result) {
			result = [];
			this._store.set(key, result);
		}
		return result;
	}

	public add(workspaceFolder: IWorkspace | IWorkspaceFolder | string, ...task: Task[]): void {
		const key = this.getKey(workspaceFolder);
		let values = this._store.get(key);
		if (!values) {
			values = [];
			this._store.set(key, values);
		}
		values.push(...task);
	}

	public all(): Task[] {
		let result: Task[] = [];
		this._store.forEach((values) => result.push(...values));
		return result;
	}
}

export class TaskProviderManager extends Disposable {
	public readonly stillProviding: Set<string> = new Set();
	private _totalProviders: number = 0;
	private _onDone: Emitter<void> = new Emitter();
	private _isDone: boolean = false;
	private _startedProviding: boolean = false;
	public onDone: Event<void> = this._onDone.event;
	private _workspaceTasks: Map<string, WorkspaceFolderTaskResult> | undefined = undefined;
	private _workspaceTaskMap: TaskMap = new TaskMap();
	private _customTasksKeyValuePairs: [string, WorkspaceFolderTaskResult][] | undefined;
	private _result: TaskMap = new TaskMap();
	private _resultSet: TaskSet[] = [];
	private _rawContributedTasks: TaskMap[] = [];
	private _unUsedConfigurations: Map<string, ConfiguringTask> = new Map();
	private _customTasksToDelete: Task[] = [];

	private _onSingleProvider: Emitter<TaskMap> = new Emitter();
	public onSingleProvider: Event<TaskMap> = this._onSingleProvider.event;

	private canceled: CancellationTokenSource = new CancellationTokenSource();

	constructor(private _outputChannel: IOutputChannel,
		private _providers: Map<number, ITaskProvider>,
		private _providerTypes: Map<number, string>,
		private _configurationService: IConfigurationService) {
		super();
	}

	get workspaceTasksMap(): TaskMap {
		return this._workspaceTaskMap;
	}

	get isDone(): boolean {
		return this._isDone;
	}

	get startedProviding(): boolean {
		return this._startedProviding;
	}

	get totalProviders(): number {
		return this._totalProviders;
	}

	get allTasks(): Task[] | undefined {
		if (this._isDone) {
			return this._result.all();
		}
		return undefined;
	}

	public cancel() {
		this._isDone = true;
		this._onDone.fire();
		this.canceled.cancel();
	}

	private async provideTasksWithCancel(provider: ITaskProvider, type: string, validTypes: IStringDictionary<boolean>): Promise<{ set: TaskSet, type: string } | undefined> {
		return new Promise<{ set: TaskSet, type: string }>(async (resolve, reject) => {
			let isDone = false;
			let disposable: IDisposable | undefined;
			const providePromise = provider.provideTasks(validTypes);
			disposable = this.canceled.token.onCancellationRequested(() => {
				if (!isDone) {
					resolve();
				}
			});
			providePromise.then((value) => {
				isDone = true;
				disposable?.dispose();
				resolve({ set: value, type });
			}, (e) => {
				isDone = true;
				disposable?.dispose();
				reject(e);
			});
		});
	}

	public async result(): Promise<TaskMap> {
		if (this._isDone) {
			return this._result;
		} else {
			return new Promise(resolve => {
				this._register(Event.once(this._onDone.event)(() => {
					resolve(this._result);
				}));
			});
		}
	}

	public async resultSet(): Promise<TaskSet[]> {
		if (this._isDone) {
			return this._resultSet;
		} else {
			return new Promise(resolve => {
				this._register(Event.once(this._onDone.event)(() => {
					resolve(this._resultSet);
				}));
			});
		}
	}

	private isProvideTasksEnabled(): boolean {
		const settingValue = this._configurationService.getValue('task.autoDetect');
		return settingValue === 'on';
	}

	public async getProviderTasks(type?: string): Promise<TaskSet[]> {
		if (!this.isProvideTasksEnabled()) {
			return [];
		}
		this._startedProviding = true;
		let validTypes: IStringDictionary<boolean> = Object.create(null);
		TaskDefinitionRegistry.all().forEach(definition => {
			validTypes[definition.taskType] = !type || definition.taskType === type;
		});
		validTypes['shell'] = true;
		validTypes['process'] = true;
		return new Promise<TaskSet[]>(resolve => {
			let counter: number = 0;
			let done = async (value: { set: TaskSet, type: string } | undefined) => {
				if (value) {
					this.stillProviding.delete(value.type);
					await this.singleProviderFinished(value.set);
					this._resultSet.push(value.set);
				}
				if (--counter === 0) {
					this.allProvidersFinished();
					resolve(this._resultSet);
				}
			};
			let error = (error: any) => {
				try {
					if (error && Types.isString(error.message)) {
						this._outputChannel.append('Error: ');
						this._outputChannel.append(error.message);
						this._outputChannel.append('\n');
					} else {
						this._outputChannel.append('Unknown error received while collecting tasks from providers.\n');
					}
				} finally {
					if (--counter === 0) {
						resolve(this._resultSet);
					}
				}
			};
			if (this._providers.size > 0) {
				for (const [handle, provider] of this._providers) {
					if ((type === undefined) || (type === this._providerTypes.get(handle))) {
						counter++;
						this._totalProviders++;
						this.stillProviding.add(this._providerTypes.get(handle)!);
						this.provideTasksWithCancel(provider, this._providerTypes.get(handle)!, validTypes).then(done, error);
					}
				}
			} else {
				this.allProvidersFinished();
				resolve(this._resultSet);
			}
		});
	}

	public async startProviding(workspaceTasks: Map<string, WorkspaceFolderTaskResult>) {
		await this.setWorkspaceTasks(workspaceTasks);
		this.getProviderTasks();
	}

	public async setWorkspaceTasks(workspaceTasks: Map<string, WorkspaceFolderTaskResult>): Promise<boolean> {
		this._workspaceTasks = workspaceTasks;
		this._customTasksKeyValuePairs = Array.from(this._workspaceTasks);
		for (const [key, folderTasks] of this._customTasksKeyValuePairs) {
			if (folderTasks.set) {
				this.addToSingleAndResult(this._workspaceTaskMap, key, ...folderTasks.set.tasks);
			}
			let configurations = folderTasks.configurations;
			let legacyTaskConfigurations = folderTasks.set ? this.getLegacyTaskConfigurations(folderTasks.set) : undefined;
			if (configurations || legacyTaskConfigurations) {
				if (configurations) {
					Object.keys(configurations.byIdentifier).forEach(key => this._unUsedConfigurations.set(key, configurations!.byIdentifier[key]));
				}

				const unUsedConfigurationsAsArray = Array.from(this._unUsedConfigurations);

				const unUsedConfigurationPromises = unUsedConfigurationsAsArray.map(async (value) => {
					let configuringTask = configurations!.byIdentifier[value[0]];
					if (!configuringTask) {
						return;
					}

					for (const [handle, provider] of this._providers) {
						if (configuringTask.type === this._providerTypes.get(handle)) {
							try {
								const resolvedTask = await provider.resolveTask(configuringTask);
								if (resolvedTask && (resolvedTask._id === configuringTask._id)) {
									this._unUsedConfigurations.delete(configuringTask.configures._key);
									this.addToSingleAndResult(this._workspaceTaskMap, key, TaskConfig.createCustomTask(resolvedTask, configuringTask));
									return;
								}
							} catch (error) {
								// Ignore errors. The task could not be provided by any of the providers.
							}
						}
					}
				});

				await Promise.all(unUsedConfigurationPromises);
			}
		}
		return this._unUsedConfigurations.size === 0;
	}

	private allProvidersFinished() {
		if (!this._customTasksKeyValuePairs) {
			return;
		}
		this._rawContributedTasks.forEach(contributedTasks => {
			for (const [key, folderTasks] of this._customTasksKeyValuePairs!) {
				if (!folderTasks.set) {
					continue;
				}
				if (this._customTasksToDelete.length > 0) {
					let toDelete = this._customTasksToDelete.reduce<IStringDictionary<boolean>>((map, task) => {
						map[task._id] = true;
						return map;
					}, Object.create(null));
					for (let task of folderTasks.set.tasks) {
						if (toDelete[task._id]) {
							continue;
						}
						this._result.add(key, task);
					}
				}
			}
		});
		if (this._unUsedConfigurations.size > 0) {
			Array.from(this._unUsedConfigurations).forEach(unused => {
				this._outputChannel.append(nls.localize(
					'TaskService.noConfiguration',
					'Error: The {0} task detection didn\'t contribute a task for the following configuration:\n{1}\nThe task will be ignored.\n',
					unused[1].configures.type,
					JSON.stringify(unused[1]._source.config.element, undefined, 4)
				));
			});
		}
		this._isDone = true;
		this._onDone.fire();
	}

	private addTasksToMap(taskSet: TaskSet, taskMap: TaskMap) {
		for (let task of taskSet.tasks) {
			let workspaceFolder = task.getWorkspaceFolder();
			if (workspaceFolder) {
				taskMap.add(workspaceFolder, task);
			}
		}
	}

	private addToSingleAndResult(singleResult: TaskMap, key: string, ...task: Task[]) {
		this._result.add(key, ...task);
		singleResult.add(key, ...task);
	}

	private async singleProviderFinished(set: TaskSet | undefined) {
		if (!set) {
			return;
		}
		const singleResult: TaskMap = new TaskMap();
		let contributedTasks: TaskMap = new TaskMap();
		this.addTasksToMap(set, contributedTasks);
		this._rawContributedTasks.push(contributedTasks);

		if (this._customTasksKeyValuePairs === undefined) {
			// If we can't read the tasks.json file provide at least the contributed tasks
			this.addTasksToMap(set, this._result);
			this.addTasksToMap(set, singleResult);
			this._onSingleProvider.fire(singleResult);
			return;
		}

		for (const [key, folderTasks] of this._customTasksKeyValuePairs) {
			let contributed = contributedTasks.get(key);
			if (!folderTasks.set) {
				if (contributed) {
					this.addToSingleAndResult(singleResult, key, ...contributed);
				}
				continue;
			}

			if (contributed) {
				let configurations = folderTasks.configurations;
				let legacyTaskConfigurations = folderTasks.set ? this.getLegacyTaskConfigurations(folderTasks.set) : undefined;
				if (configurations || legacyTaskConfigurations) {
					for (let task of contributed) {
						if (!ContributedTask.is(task)) {
							continue;
						}
						if (configurations) {
							let configuringTask = configurations.byIdentifier[task.defines._key];
							if (configuringTask && this._unUsedConfigurations.has(task.defines._key)) {
								this._unUsedConfigurations.delete(task.defines._key);
								const customTask = TaskConfig.createCustomTask(task, configuringTask);
								this.addToSingleAndResult(singleResult, key, customTask);
							} else {
								this.addToSingleAndResult(singleResult, key, task);
							}
						} else if (legacyTaskConfigurations) {
							let configuringTask = legacyTaskConfigurations[task.defines._key];
							if (configuringTask) {
								const customTask = TaskConfig.createCustomTask(task, configuringTask);
								this.addToSingleAndResult(singleResult, key, customTask);
								this._customTasksToDelete.push(configuringTask);
							} else {
								this.addToSingleAndResult(singleResult, key, task);
							}
						} else {
							this.addToSingleAndResult(singleResult, key, task);
						}
					}
				} else {
					this.addToSingleAndResult(singleResult, key, ...contributed);
				}
			}
		}
		this._onSingleProvider.fire(singleResult);
	}

	private getLegacyTaskConfigurations(workspaceTasks: TaskSet): IStringDictionary<CustomTask> | undefined {
		let result: IStringDictionary<CustomTask> | undefined;
		function getResult(): IStringDictionary<CustomTask> {
			if (result) {
				return result;
			}
			result = Object.create(null);
			return result!;
		}
		for (let task of workspaceTasks.tasks) {
			if (CustomTask.is(task)) {
				let commandName = task.command && task.command.name;
				// This is for backwards compatibility with the 0.1.0 task annotation code
				// if we had a gulp, jake or grunt command a task specification was a annotation
				if (commandName === 'gulp' || commandName === 'grunt' || commandName === 'jake') {
					let identifier = NKeyedTaskIdentifier.create({
						type: commandName,
						task: task.configurationProperties.name
					});
					getResult()[identifier._key] = task;
				}
			}
		}
		return result;
	}
}
