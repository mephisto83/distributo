import express, { Express } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';
import http, { Server as HTTPServer } from 'http';
import winston from 'winston';
import bonjour, { Bonjour, Service } from 'bonjour';
import os from 'os';

// Adjust these imports depending on your environment and build setup.


export interface TaskDistributorOptions<T> {
    port?: number;
    serviceType?: string;
    batchSize?: number;
    getTasks: () => T[];                 // Function to fetch an array of tasks
    handleResults: (results: T[]) => void; // Function called with completed tasks
    enableBonjour?: boolean;
}

export default class TaskDistributor<T> {
    private port: number;
    private serviceType: string;
    private batchSize: number;
    private getTasks: () => T[];
    protected handleResults: (results: T[]) => void;
    private enableBonjour: boolean;

    protected logger: winston.Logger;
    protected app: Express;
    protected server: HTTPServer;
    protected io: SocketIOServer;
    protected tasks: T[];

    private bonjourInstance: Bonjour | null = null;
    private servicePublished: Service | null = null;

    constructor(options: TaskDistributorOptions<T>) {
        this.port = options.port ?? 4000;
        this.serviceType = options.serviceType ?? 'eventbus';
        this.batchSize = options.batchSize ?? 5;
        this.getTasks = options.getTasks;
        this.handleResults = options.handleResults;
        this.enableBonjour = options.enableBonjour ?? true;

        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'master.log' }),
            ],
        });

        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new SocketIOServer(this.server, { cors: { origin: "*" } });
        this.tasks = [];

        this.setupRoutes();
        this.setupSockets();
    }

    private setupRoutes(): void {
        this.app.use(express.json());
        // Additional routes can be defined here
    }

    protected setupSockets(): void {
        this.io.on('connection', (socket: Socket) => {
            this.logger.info(`Worker connected: ${socket.id}`);

            socket.on('requestTasks', () => {
                // If we don't have any tasks loaded, fetch them now
                if (this.tasks.length === 0) {
                    this.tasks = this.getTasks() || [];
                    this.logger.info(`Loaded ${this.tasks.length} tasks in total.`);
                }

                if (this.tasks.length === 0) {
                    socket.emit('noMoreTasks', {});
                    return;
                }

                // Provide a batch of tasks and remove them from the list
                const batch: T[] = this.tasks.splice(0, this.batchSize);
                socket.emit('provideTasks', { tasks: batch });
                this.logger.info(`Provided ${batch.length} tasks to worker ${socket.id}. Remaining: ${this.tasks.length}`);
            });

            socket.on('taskResults', (data: { results: T[] }) => {
                if (data && Array.isArray(data.results)) {
                    this.handleResults(data.results);
                    this.logger.info(`Received results for ${data.results.length} tasks from ${socket.id}.`);
                }
            });

            socket.on('disconnect', () => {
                this.logger.info(`Worker disconnected: ${socket.id}`);
            });
        });
    }

    private publishBonjour(): void {
        this.bonjourInstance = bonjour();
        const nodeName = `${os.hostname()}-master`;
        this.servicePublished = this.bonjourInstance.publish({ name: nodeName, type: this.serviceType, port: this.port });
        this.logger.info(`Service published as ${nodeName} on the network.`);
    }

    public start(): void {
        this.server.listen(this.port, () => {
            const nodeName = `${os.hostname()}-master`;
            this.logger.info(`Master server (${nodeName}) running on port ${this.port}`);
            if (this.enableBonjour) {
                this.publishBonjour();
            }
        });
    }

    public stop(): void {
        // Graceful shutdown logic if needed
        // e.g., this.server.close(), this.bonjourInstance?.unpublishAll(), etc.
        if (this.servicePublished) {
            this.servicePublished.stop(() => {
                this.logger.info('Bonjour service stopped.');
            });
        }
        if (this.bonjourInstance) {
            this.bonjourInstance.destroy();
        }
        this.server.close(() => {
            this.logger.info('Server closed.');
        });
    }

    /**
     * Adds a new task to the task queue.
     * @param task - The task to add.
     */
    public addTask(task: T): void {
        this.tasks.push(task);
        this.logger.info(`Added new task. Total tasks: ${this.tasks.length}`);
    }

    /**
     * Adds multiple tasks to the task queue.
     * @param tasks - Array of tasks to add.
     */
    public addTasks(tasks: T[]): void {
        this.tasks.push(...tasks);
        this.logger.info(`Added ${tasks.length} new tasks. Total tasks: ${this.tasks.length}`);
    }
}

/*
Usage Example (example.ts):

import { TaskDistributor } from './TaskDistributor';

interface MyTask {
    word: string;
    // ... other properties
}

function getMyTasks(): MyTask[] {
    return [
        { word: "apple" },
        { word: "banana" },
        // ...
    ];
}

function handleMyResults(results: MyTask[]): void {
    // write results somewhere
    console.log('Results received:', results.length);
}

const distributor = new TaskDistributor<MyTask>({
    port: 4000,
    serviceType: 'eventbus',
    batchSize: 5,
    getTasks: getMyTasks,
    handleResults: handleMyResults,
    enableBonjour: true
});

distributor.start();
*/
