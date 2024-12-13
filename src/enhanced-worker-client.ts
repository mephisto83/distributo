// EnhancedWorkerClient.ts

import { io as ClientIO, Socket } from 'socket.io-client';
import winston from 'winston';
import bonjour, { Bonjour, RemoteService } from 'bonjour';
import { DynamicTask } from './interface.js';
import { setupDynamicTask } from './setupDynamicTask.js';
import { executeDynamicTask } from './executeDynamicTask.js';

interface EnhancedWorkerClientOptions {
    serviceType?: string;
    masterUrl?: string;  // Optional direct URL to master, if discovery not needed
    taskTypes: string[]; // Types of tasks this worker can handle
    logger?: winston.Logger;
    discoveryTimeoutMs?: number;
}

interface TaskResult {
    taskId: string;
    result: any;
}

function createDefaultLogger(): winston.Logger {
    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
        ),
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: 'worker.log' }),
        ],
    });
}

export default class EnhancedWorkerClient {
    private serviceType: string;
    private masterUrl?: string;
    private taskTypes: string[];
    private logger: winston.Logger;
    private discoveryTimeoutMs: number;

    private bonjourInstance: Bonjour | null = null;
    private socket: Socket | null = null;

    constructor(options: EnhancedWorkerClientOptions) {
        this.serviceType = options.serviceType ?? 'eventbus';
        this.masterUrl = options.masterUrl;
        this.taskTypes = options.taskTypes;
        this.logger = options.logger ?? createDefaultLogger();
        this.discoveryTimeoutMs = options.discoveryTimeoutMs ?? 10000;
    }

    /**
     * Start the worker.
     */
    public async start(): Promise<void> {
        try {
            const url = this.masterUrl ?? await this.discoverMaster();
            await this.connectToMaster(url);
        } catch (err: any) {
            this.logger.error(`Could not start worker: ${err.message}`);
            process.exit(1);
        }
    }

    /**
     * Attempt to discover the master node via Bonjour if no URL is provided.
     */
    private discoverMaster(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (this.masterUrl) {
                // If masterUrl is provided, no need to discover
                return resolve(this.masterUrl);
            }

            this.bonjourInstance = bonjour();
            this.logger.info(`Looking for ${this.serviceType} services on the network...`);
            const browser = this.bonjourInstance.find({ type: this.serviceType });

            let found = false;
            browser.on('up', (service) => {
                const host = service.host === 'localhost' ? '127.0.0.1' : service.host;
                const url = `http://${host}:${service.port}`;
                this.logger.info(`Discovered master node: ${service.name} at ${url}`);
                if (!found) {
                    found = true;
                    browser.stop();
                    this.bonjourInstance?.destroy();
                    resolve(url);
                }
            });

            setTimeout(() => {
                if (!found) {
                    reject(new Error(`No master node found on the network within ${this.discoveryTimeoutMs}ms.`));
                }
            }, this.discoveryTimeoutMs);
        });
    }

    /**
     * Connect to the master server via Socket.IO and set up event handlers.
     */
    private async connectToMaster(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.logger.info(`Connecting to master at ${url}...`);
            this.socket = ClientIO(url, { reconnectionAttempts: 3 });

            this.socket.on('connect', () => {
                this.logger.info(`Connected to master at ${url}`);

                // Register capabilities
                this.socket?.emit('registerCapabilities', { taskTypes: this.taskTypes });

                // Notify master that worker is ready for these taskTypes
                this.socket?.emit('notifyReady', { taskTypes: this.taskTypes });

                // Request the first task
                this.socket?.emit('requestTask');

                resolve();
            });

            this.socket.on('assignTask', async (data: { task: DynamicTask }) => {
                this.logger.info(`Received task ${data.task.taskId} of type ${data.task.taskType}`);
                try {
                    // Setup the task environment
                    await setupDynamicTask(data.task);
                    this.logger.info(`Setup completed for task ${data.task.taskId}`);

                    // Notify master that installation was successful
                    this.socket?.emit('installationStatus', { taskId: data.task.taskId, status: 'success' });

                    // Execute the task
                    const result = await executeDynamicTask(data.task);
                    this.logger.info(`Executing task ${data.task.taskId}`);

                    // Send back the result
                    const taskResult: TaskResult = {
                        taskId: data.task.taskId || 'N/A',
                        result,
                    };

                    this.socket?.emit('taskCompleted', { taskId: taskResult.taskId, result: taskResult.result });
                    this.logger.info(`Task ${taskResult.taskId} completed and results sent to master.`);
                } catch (error: any) {
                    this.logger.error(`Error executing task ${data.task.taskId}: ${error.message}`);
                    // Notify master of task failure
                    this.socket?.emit('installationStatus', { taskId: data.task.taskId || 'N/A', status: 'failure', error: error.message });
                    // Optionally, notify master of execution failure
                    this.socket?.emit('taskCompleted', { taskId: data.task.taskId || 'N/A', result: { error: error.message } });
                }
            });

            this.socket.on('noTask', (data: { message: string }) => {
                this.logger.info(`No task received: ${data.message}`);
                // Optionally, implement a retry mechanism or wait before requesting again
            });

            this.socket.on('disconnect', () => {
                this.logger.warn('Disconnected from master.');
            });

            this.socket.on('connect_error', (err: Error) => {
                this.logger.error(`Connection error: ${err.message}`);
                reject(err);
            });
        });
    }
}