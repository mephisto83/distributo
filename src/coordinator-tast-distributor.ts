// CoordinatorTaskDistributor.ts

import express, { Request, Response } from 'express';
import TaskDistributor from './task-distributor.js'; // Adjust the import path as necessary
import { DynamicTask, TaskResult } from './interface.js';
import { generateDynamicTask } from './generateDynamicTask.js'; // Adjust the import path
import path from 'path';
import winston from 'winston';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { asyncHandler } from './asyncHandler.js';

interface CoordinatorOptions {
    port?: number;
    httpPort?: number; // Port for HTTP server to receive task messages
    taskFolderPath: string; // Base path where project folders are located
    serviceType?: string;
    batchSize?: number;
    discoveryTimeoutMs?: number;
    enableBonjour?: boolean;
    logger?: winston.Logger;
    onResult?: (arg: any) => void;
    taskGenerator?: () => Promise<DynamicTask[]>;
}

interface WorkerInfo {
    socketId: string;
    taskTypes: string[];
    isReady: boolean; // Indicates if the worker has completed setup
}

interface TaskStatus {
    task: DynamicTask;
    assignedTo: string; // socketId of the Worker
    status: 'pending' | 'installed' | 'failed' | 'completed';
}

export class CoordinatorTaskDistributor extends TaskDistributor<DynamicTask> {
    private httpServer: import('http').Server;
    private httpPort: number;
    private taskFolderPath: string;
    private taskGenerator?: () => Promise<DynamicTask[]>;

    private promiseTrain: Promise<void>;
    // Mapping of worker socket IDs to their capabilities and status
    private workers: Map<string, WorkerInfo> = new Map();
    // Tracking task statuses
    private taskStatuses: Map<string, TaskStatus> = new Map();
    private taskStatusHandled: Map<string, boolean> = new Map();
    private onResult: (arg: any) => void;
    constructor(options: CoordinatorOptions) {
        const {
            httpPort = 5000,
            taskFolderPath,
            serviceType = 'eventbus',
            batchSize = 5,
            discoveryTimeoutMs = 10000,
            enableBonjour = true,
            logger,
        } = options;

        // Initialize the base TaskDistributor with DynamicTask
        super({
            port: options.port || 4000, // Master server port
            serviceType,
            batchSize,
            getTasks: () => this.getAvailableTasks(),
            handleResults: (results: any[]) => this.handleTaskResults(results),
            enableBonjour,
        });

        this.promiseTrain = Promise.resolve();
        this.taskGenerator = options.taskGenerator;

        // Initialize Express app for receiving task messages
        this.app = express();
        this.app.use(express.json());
        this.httpPort = httpPort;
        this.taskFolderPath = path.resolve(taskFolderPath);
        this.onResult = options.onResult || ((a: any) => { });
        // Initialize logger
        this.logger = logger ?? winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'coordinator.log' }),
            ],
        });

        this.setupHttpRoutes();
        this.setupSockets();

        // Start the HTTP server
        this.httpServer = this.app.listen(this.httpPort, () => {
            this.logger.info(`Coordinator HTTP server running on port ${this.httpPort}`);
        });
        this.setupOnConnected();
    }
    protected async gooseTasks() {
        console.log('Goose the task list')
        if (this.taskGenerator) {
            console.log('getting new tasks')
            let newTasks = await this.taskGenerator();
            if (newTasks?.length) {
                this.tasks.push(...newTasks);
                for (let dynamicTask of newTasks) {
                    // Initialize task status with dynamicTask instead of undefined task
                    this.taskStatuses.set(dynamicTask.taskId || '', {
                        task: dynamicTask,
                        assignedTo: '',
                        status: 'pending',
                    });
                }
            }
        }
        else {
            console.log('No task generator')
        }
    }
    async appendTask(projectName: string, taskType: string, options: {
        type?: string;
        args?: string[];
        env?: Record<string, string>;
        workingDirectory?: string;
        taskId?: string;
        timeout?: number;
        additionalOptions?: Record<string, any>;
    }) {
        // Define the path to the project folder
        const projectPath = path.join(this.taskFolderPath, projectName);

        // Generate the DynamicTask
        const dynamicTask: DynamicTask = await generateDynamicTask(projectPath, taskType, options);

        // Add the task to the distributor
        this.addTask(dynamicTask);

        // Initialize task status with dynamicTask instead of undefined task
        this.taskStatuses.set(dynamicTask.taskId || '', {
            task: dynamicTask,
            assignedTo: '',
            status: 'pending',
        });
    }
    /**
     * Sets up HTTP routes to receive task messages.
     */
    private setupHttpRoutes(): void {
        /**
         * Endpoint to receive a new task.
         * Expects JSON body with necessary information to generate a DynamicTask.
         * Example POST body:
         * {
         *   "projectName": "my-project",
         *   "options": {
         *       "type": "executeCode",
         *       "taskType": "typeA",
         *       "args": ["--port=3000"],
         *       "env": { "NODE_ENV": "production" },
         *       "taskId": "task-abc-123",
         *       "timeout": 60000,
         *       "additionalOptions": { "useDocker": false }
         *   }
         * }
         */
        this.app.post('/addTask', asyncHandler(async (req: Request, res: Response) => {
            const { projectName, options } = req.body;

            if (!projectName) {
                this.logger.warn('Received /addTask request without projectName');
                return res.status(400).json({ error: 'Missing projectName in request body.' });
            }

            if (!options || !options.taskType) {
                this.logger.warn('Received /addTask request without taskType');
                return res.status(400).json({ error: 'Missing taskType in options.' });
            }

            try {
                // Define the path to the project folder
                const projectPath = path.join(this.taskFolderPath, projectName);

                // Generate the DynamicTask
                const dynamicTask: DynamicTask = await generateDynamicTask(projectPath, options);

                // Add the task to the distributor
                this.addTask(dynamicTask);

                // Initialize task status with dynamicTask instead of undefined task
                this.taskStatuses.set(dynamicTask.taskId || '', {
                    task: dynamicTask,
                    assignedTo: '',
                    status: 'pending',
                });

                this.logger.info(`Added new task from project: ${projectName}, Task ID: ${options?.taskId || 'N/A'}, Task Type: ${options.taskType}`);
                return res.status(200).json({ message: 'Task added successfully.', taskId: options?.taskId });
            } catch (error: any) {
                this.logger.error(`Error adding task: ${error.message}`);
                return res.status(500).json({ error: error.message });
            }
        }));

        /**
         * Endpoint to receive multiple tasks at once.
         * Expects an array of task messages.
         * Example POST body:
         * [
         *   {
         *     "projectName": "project1",
         *     "options": { "taskType": "typeA", ... }
         *   },
         *   {
         *     "projectName": "project2",
         *     "options": { "taskType": "typeB", ... }
         *   }
         * ]
         */
        this.app.post('/addTasks', asyncHandler(async (req: Request, res: Response) => {
            const tasks = req.body;

            if (!Array.isArray(tasks)) {
                this.logger.warn('Received /addTasks request with non-array body');
                return res.status(400).json({ error: 'Request body must be an array of tasks.' });
            }

            const addedTasks: string[] = [];
            const failedTasks: { projectName: string; error: string }[] = [];

            for (const task of tasks) {
                const { projectName, options } = task;

                if (!projectName) {
                    this.logger.warn('Received a task without projectName');
                    failedTasks.push({ projectName: 'undefined', error: 'Missing projectName.' });
                    continue;
                }

                if (!options || !options.taskType) {
                    this.logger.warn(`Received a task without taskType for project ${projectName}`);
                    failedTasks.push({ projectName, error: 'Missing taskType in options.' });
                    continue;
                }

                try {
                    const projectPath = path.join(this.taskFolderPath, projectName);
                    const dynamicTask: DynamicTask = await generateDynamicTask(projectPath, options);
                    this.addTask(dynamicTask);

                    // Initialize task status with dynamicTask instead of undefined task
                    this.taskStatuses.set(dynamicTask.taskId || '', {
                        task: dynamicTask,
                        assignedTo: '',
                        status: 'pending',
                    });

                    addedTasks.push(options?.taskId || 'N/A');
                    this.logger.info(`Added new task from project: ${projectName}, Task ID: ${options?.taskId || 'N/A'}, Task Type: ${options.taskType}`);
                } catch (error: any) {
                    this.logger.error(`Error adding task from project ${projectName}: ${error.message}`);
                    failedTasks.push({ projectName, error: error.message });
                }
            }

            return res.status(200).json({ addedTasks, failedTasks });
        }));
    }

    protected setupOnConnected() {
        this.onConnected = (socket: Socket) => {
            // Initialize worker info
            this.workers.set(socket.id, {
                socketId: socket.id,
                taskTypes: [],
                isReady: false,
            });

            /**
             * Event: registerCapabilities
             * Payload: { taskTypes: string[] }
             * Description: Workers send this event to register the types of tasks they can handle.
             */
            socket.on('registerCapabilities', (data: { taskTypes: string[] }) => {
                const worker = this.workers.get(socket.id);
                if (worker) {
                    worker.taskTypes = data.taskTypes;
                    this.workers.set(socket.id, worker);
                    this.logger.info(`Worker ${socket.id} registered capabilities: ${data.taskTypes.join(', ')}`);
                }
            });

            /**
             * Event: notifyReady
             * Payload: { taskTypes: string[] }
             * Description: Workers notify the Coordinator that they have completed setup for specified task types.
             */
            socket.on('notifyReady', (data: { taskTypes: string[] }) => {
                const worker = this.workers.get(socket.id);
                if (worker) {
                    data.taskTypes.forEach(taskType => {
                        if (!worker.taskTypes.includes(taskType)) {
                            worker.taskTypes.push(taskType);
                        }
                    });
                    worker.isReady = true;
                    this.workers.set(socket.id, worker);
                    this.logger.info(`Worker ${socket.id} is ready to handle tasks: ${data.taskTypes.join(', ')}`);
                }
            });

            /**
             * Event: requestTask
             * Description: Workers request a task. Coordinator assigns a suitable task based on worker's capabilities.
             */
            socket.on('requestTask', async () => {
                this.promiseTrain = this.promiseTrain.then(async () => {
                    const worker = this.workers.get(socket.id);
                    if (!worker || !worker.isReady || worker.taskTypes.length === 0) {
                        this.logger.warn(`Worker ${socket.id} is not ready or has no capabilities.`);
                        socket.emit('noTask', { message: 'Worker not ready or has no capabilities.' });
                        return;
                    }
                    if (!this.tasks?.length)
                        await this.gooseTasks();
                    // Find a task that matches one of the worker's taskTypes and is pending
                    const suitableTaskIndex = this.tasks.findIndex(task => worker.taskTypes.includes(task.taskType) && this.taskStatuses.get(task.taskId || '')?.status === 'pending');

                    if (suitableTaskIndex === -1) {
                        this.logger.info(`No suitable tasks available for worker ${socket.id}.`);
                        socket.emit('noTask', { message: 'No suitable tasks available.' });
                        return;
                    }

                    // Assign the task to the worker
                    const task = this.tasks.splice(suitableTaskIndex, 1)[0];
                    socket.emit('assignTask', { task });

                    // Update task status
                    this.taskStatuses.set(task.taskId || '', {
                        task,
                        assignedTo: socket.id,
                        status: 'installed', // Assume installation is handled by the Worker
                    });

                    this.logger.info(`Assigned task ${task.taskId} of type ${task.taskType} to worker ${socket.id}.`);
                });

                await this.promiseTrain;
            });

            /**
             * Event: taskCompleted
             * Payload: { taskId: string, result: any }
             * Description: Workers send this event upon completing a task.
             */
            socket.on('taskCompleted', (data: TaskResult) => {
                this.logger.info(`Worker ${socket.id} completed task ${data.taskId}.`);

                const taskStatus = this.taskStatuses.get(data.taskId);
                if (taskStatus) {
                    taskStatus.status = 'completed';
                    this.taskStatuses.set(data.taskId, taskStatus);
                }

                this.handleResults([data] as any);

                // Optionally, assign a new task
                socket.emit('requestTask');
            });

            /**
             * Event: installationStatus
             * Payload: { taskId: string, status: 'success' | 'failure', error?: string }
             * Description: Workers notify the Coordinator about the status of task installation.
             */
            socket.on('installationStatus', (data: { taskId: string; status: 'success' | 'failure'; error?: string }) => {
                const { taskId, status, error } = data;
                this.logger.info(`Worker ${socket.id} installation status for task ${taskId}: ${status}`);

                const taskStatus = this.taskStatuses.get(taskId);
                if (taskStatus) {
                    if (status === 'success') {
                        taskStatus.status = 'installed';
                        this.taskStatuses.set(taskId, taskStatus);
                        this.logger.info(`Task ${taskId} installed successfully on worker ${socket.id}.`);
                    } else if (status === 'failure') {
                        taskStatus.status = 'failed';
                        this.taskStatuses.set(taskId, taskStatus);
                        this.logger.error(`Task ${taskId} failed to install on worker ${socket.id}. Error: ${error}`);
                        // Optionally, re-queue the task or handle failure
                        this.tasks.push(taskStatus.task);
                    }
                }
            });

            /**
             * Event: disconnect
             * Description: Handle worker disconnection.
             */
            socket.on('disconnect', () => {
                this.logger.info(`Worker disconnected: ${socket.id}`);
                this.workers.delete(socket.id);

                // Reassign any tasks that were assigned to this worker
                this.taskStatuses.forEach((status, taskId) => {
                    if (status.assignedTo === socket.id && status.status !== 'completed') {
                        this.logger.info(`Re-queuing task ${taskId} due to worker ${socket.id} disconnection.`);
                        this.tasks.push(status.task);
                        this.taskStatuses.delete(taskId);
                    }
                });
            });
        }
    }
    /**
     * Sets up Socket.IO event handlers to manage worker capabilities and task assignments.
     */
    protected setupSockets(): void {
        super.setupSockets();
    }

    /**
     * Retrieves available tasks based on workers' capabilities and setup status.
     * @returns An array of DynamicTask objects.
     */
    private getAvailableTasks(): DynamicTask[] {
        return this.tasks;
    }

    /**
     * Handles the results received from workers.
     * @param results - Array of task results.
     */
    private handleTaskResults(results: any[]): void {
        // Implement your logic to handle task results
        // For example, logging, storing in a database, etc.
        this.logger.info(`Received results for ${results.length} tasks.`);
        results.forEach(result => {
            // Process each result as needed
            this.logger.info(`Task ID: ${result.taskId}, Status: Success, Result: ${JSON.stringify(result)}`);
            // Example: Store results in a database or perform further actions
        });
        if (this.onResult) {
            try {
                this.onResult(results.filter(x => !this.taskStatusHandled.get(x)));
                for (let i = 0; i < results?.length; i++) {
                    let d = results[i];
                    this.taskStatusHandled.set(d.taskId, true);
                }
            } catch (e) {
                console.error(e);
            }
        }
    }

    /**
     * Stops the Coordinator, including HTTP and Socket.IO servers.
     */
    public override stop(): void {
        super.stop();
        this.httpServer.close(() => {
            this.logger.info('Coordinator HTTP server closed.');
        });
    }
}