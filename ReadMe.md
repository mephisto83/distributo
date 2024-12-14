![Distributo](images/logo.webp)
# Distributo

**Distributo** is a TypeScript-based framework designed to streamline the distribution of tasks from a master node (the **Task Distributor**) to multiple worker nodes (the **Worker Clients**). It provides a simple API for discovering, connecting, and coordinating workers and a master server over a network using Socket.IO and optional Bonjour-based service discovery.

## Features

- **Master/Worker Architecture**: Easily distribute tasks from a central master server to multiple workers.
- **Generic Task Definitions**: Define tasks using TypeScript interfaces, enabling strong typing and flexibility.
- **Pluggable Task Retrieval and Result Handling**: Pass in your own functions to determine how tasks are retrieved and how results are processed.
- **Bonjour Discovery (Optional)**: Seamlessly discover the master server on a local network without manual configuration.
- **Built-In Logging**: Track connections, task distribution, and results with integrated logging.

**Newly Introduced Components:**
- **EnhancedWorkerClient**: An advanced worker client that supports dynamic task setup, installation, and execution. It can discover the master node via Bonjour or connect directly if given a URL. It provides flexible capabilities registration and robust error handling.
- **CoordinatorTaskDistributor**: An extended and more powerful coordinator (master) that supports dynamic task management via HTTP endpoints, task generators, and granular task status tracking. It can also publish itself on the network using Bonjour, allowing EnhancedWorkerClients to discover it automatically.

## How It Works

1. **The Master (Task Distributor / CoordinatorTaskDistributor)**  
   The master node runs a server that:
   - Provides tasks (either statically or dynamically generated) to connected workers upon request.
   - Tracks task statuses through installation, execution, and completion stages.
   - Offers HTTP endpoints for adding tasks on-the-fly.
   - Receives completed results from workers and processes them via a user-defined callback.

2. **The Workers (WorkerClient / EnhancedWorkerClient)**  
   Each worker:
   - Discovers (or is directed to) the master node.
   - Requests tasks from the master.
   - Depending on the worker type:
     - **WorkerClient**: Receives batches of tasks and processes them directly.
     - **EnhancedWorkerClient**: Handles more complex workflows, including task setup, installation checks, and dynamic directory management.
   - Executes the assigned tasks using a user-defined function and returns the results.
   - Continues requesting new tasks until there are none left, handling errors and reconnection automatically.

## Installation

```bash
npm install
```

Make sure you have Node.js and npm installed, as well as TypeScript if you’re working from source.

## Requirements

- **Node.js** (v12+ recommended)
- **TypeScript** (v4+ recommended for development)
- **Socket.IO** for networking (already included as dependency)
- **Bonjour** for optional network discovery
- Appropriate type definitions (`@types/express`, `@types/socket.io`, `@types/bonjour`, `@types/node`, etc.)

## Usage Example (Basic Setup)

### Master Node (Task Distributor)

Below is an example of setting up the original, simpler `TaskDistributor` master node:

```typescript
import { TaskDistributor } from './TaskDistributor';

interface MyTask {
    word: string;
    // Add any other fields your task might require
}

function getMyTasks(): MyTask[] {
    return [
        { word: "apple" },
        { word: "banana" },
        // ... your tasks
    ];
}

function handleMyResults(results: MyTask[]): void {
    // Handle the processed results (e.g., save to DB, write to file)
    console.log('Results received:', results.length);
}

const distributor = new TaskDistributor<MyTask>({
    port: 4000,              // The port to listen on
    serviceType: 'eventbus', // The Bonjour service type
    batchSize: 5,            // Number of tasks to send to each worker per request
    getTasks: getMyTasks,
    handleResults: handleMyResults,
    enableBonjour: true      // Enable Bonjour-based service discovery
});

distributor.start();
```

### Worker Node (Worker Client)

A basic `WorkerClient`:

```typescript
import { WorkerClient } from './WorkerClient';

interface MyTask {
    word: string;
}

interface MyResult {
    word: string;
    syllableData: any;
}

async function processMyTasks(tasks: MyTask[]): Promise<MyResult[]> {
    const results: MyResult[] = [];
    for (const task of tasks) {
        const data = await scrapeSyllableData(task.word);
        if (data) {
            results.push({ word: task.word, syllableData: data });
        }
    }
    return results;
}

const worker = new WorkerClient<MyTask, MyResult>({
    serviceType: 'eventbus',  // Matches the master's serviceType
    processTasks: processMyTasks
});

worker.start();

// `scrapeSyllableData(word: string)` should be defined by you.
```

## Advanced Usage with EnhancedWorkerClient and CoordinatorTaskDistributor

### CoordinatorTaskDistributor (Advanced Master)

`CoordinatorTaskDistributor` is a more robust version of the master node that:

- Allows adding tasks via HTTP endpoints (`/addTask` and `/addTasks`).
- Optionally uses a `taskGenerator` for dynamic task provisioning.
- Maintains detailed task statuses and supports re-queuing tasks if workers disconnect.
- Publishes itself on the network for discovery by `EnhancedWorkerClient`.

```typescript
import { CoordinatorTaskDistributor } from './CoordinatorTaskDistributor';

const coordinator = new CoordinatorTaskDistributor({
    port: 4000,
    httpPort: 5000,
    taskFolderPath: '/path/to/projects',
    serviceType: 'eventbus',
    enableBonjour: true,
    onResult: (results) => {
        console.log('Handled results:', results);
    },
    taskGenerator: async () => {
        // Dynamically return an array of tasks
        return [{ taskId: 'dynamic-task-1', taskType: 'build', type: 'executeCode', ...otherProps }];
    }
});

coordinator.start();
```

You can now `POST` tasks to `http://localhost:5000/addTask` or `http://localhost:5000/addTasks` to feed new tasks into the system.

### EnhancedWorkerClient (Advanced Worker)

`EnhancedWorkerClient` is designed to handle more complex tasks that require setup or installation phases before execution. It:

- Discovers the master node automatically or connects via a specified URL.
- Registers its capabilities (task types it can handle).
- Sets up, installs dependencies for, and then executes tasks.
- Provides detailed logging and handles failure states gracefully.

```typescript
import EnhancedWorkerClient from './EnhancedWorkerClient';

const worker = new EnhancedWorkerClient({
    serviceType: 'eventbus',
    taskTypes: ['build', 'test'], // The tasks this worker can handle
    workingDirectory: '/path/to/workdir',
});

worker.start();
```

## Bonjour Discovery

With Bonjour enabled, workers (either `WorkerClient` or `EnhancedWorkerClient`) automatically find the master on the local network by the specified `serviceType`. If you prefer a static setup, you can skip Bonjour and provide the `masterUrl` directly:

```typescript
const worker = new EnhancedWorkerClient({
    masterUrl: 'http://127.0.0.1:4000', // Direct connection, no Bonjour required
    taskTypes: ['build', 'test'],
});
```

## Logging

Both the master and the workers come with a built-in logger using `winston`. Logs are printed to the console and written to `.log` files. You can customize the logger by passing in your own `winston.Logger` instance.

## Error Handling

- The workers and master both log connection errors, missing tasks, and other issues.
- Workers exit gracefully when no more tasks are available.
- For advanced scenarios, `EnhancedWorkerClient` reports setup/installation failures back to the coordinator, allowing for re-queueing or custom fallback strategies.

## Extending Distributo

**Distributo** is designed to be flexible:

- **Custom Task Shapes**: Just define your own interfaces for tasks and results.
- **Custom Retrieval & Dynamic Tasks**: The `CoordinatorTaskDistributor` can integrate with a `taskGenerator` function to dynamically provision tasks.
- **Custom Processing**: Workers can perform anything from scraping websites to running ML models.
- **Multiple Workers**: Run multiple worker instances for parallel task processing.
- **Detailed Task States**: With the `CoordinatorTaskDistributor` and `EnhancedWorkerClient`, you can track tasks through installation, execution, and completion phases.

## Contributing

Contributions are welcome! Please submit pull requests with new features or bug fixes, and ensure you run tests and follow the code style guidelines.

## License

This project is released under the MIT License.

---

**Happy distributing!**
