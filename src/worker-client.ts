import { io as ClientIO, Socket } from 'socket.io-client';
import winston from 'winston';
import bonjour, { Bonjour, RemoteService } from 'bonjour';

// Configuration interface for the WorkerClient
interface WorkerClientOptions<TaskType, ResultType> {
    serviceType?: string;
    masterUrl?: string;  // Optional direct URL to master, if discovery not needed
    processTasks: (tasks: TaskType[]) => Promise<ResultType[]>;
    logger?: winston.Logger;
    discoveryTimeoutMs?: number;
}

// Default logger
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

export class WorkerClient<TaskType = unknown, ResultType = unknown> {
    private serviceType: string;
    private masterUrl?: string;
    private processTasksFn: (tasks: TaskType[]) => Promise<ResultType[]>;
    private logger: winston.Logger;
    private discoveryTimeoutMs: number;

    private bonjourInstance: Bonjour | null = null;
    private socket: Socket | null = null;

    constructor(options: WorkerClientOptions<TaskType, ResultType>) {
        this.serviceType = options.serviceType ?? 'eventbus';
        this.masterUrl = options.masterUrl;
        this.processTasksFn = options.processTasks;
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
            browser.on('up', (service: RemoteService) => {
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
                this.socket?.emit('requestTasks');
                resolve();
            });

            this.socket.on('provideTasks', async (data: { tasks: TaskType[] }) => {
                this.logger.info(`Received ${data.tasks.length} tasks`);
                const results = await this.processTasksFn(data.tasks);
                this.logger.info(`Finished processing ${results.length} tasks`);
                this.socket?.emit('taskResults', { results });
                this.socket?.emit('requestTasks');
            });

            this.socket.on('noMoreTasks', () => {
                this.logger.info('No more tasks available. Worker shutting down.');
                process.exit(0);
            });

            this.socket.on('connect_error', (err: Error) => {
                this.logger.error(`Failed to connect to master: ${err.message}`);
                // If we fail to connect, reject so we can handle it in start()
                reject(err);
            });
        });
    }
}

/**
 * Example usage:
 * 
 * // Suppose a Task is just a string (a word), and Result is an object with word and some data.
 * interface MyTask {
 *    word: string;
 * }
 * 
 * interface MyResult {
 *    word: string;
 *    syllableData: any;
 * }
 * 
 * async function processMyTasks(tasks: MyTask[]): Promise<MyResult[]> {
 *     const results: MyResult[] = [];
 *     for (const task of tasks) {
 *         const data = await scrapeSyllableData(task.word);
 *         if (data) {
 *             results.push({ word: task.word, syllableData: data });
 *         }
 *     }
 *     return results;
 * }
 * 
 * const worker = new WorkerClient<MyTask, MyResult>({
 *     serviceType: 'eventbus',
 *     processTasks: processMyTasks
 * });
 * 
 * worker.start();
 * 
 * // Where scrapeSyllableData(word: string) is a function that performs Puppeteer scraping as in the original code.
 */
