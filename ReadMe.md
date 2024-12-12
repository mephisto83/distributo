![Distributo](images/logo.webp)
# Distributo

**Distributo** is a TypeScript-based framework designed to streamline the distribution of tasks from a master node (the **Task Distributor**) to multiple worker nodes (the **Worker Clients**). It provides a simple API for discovering, connecting, and coordinating workers and a master server over a network using Socket.IO and optional Bonjour-based service discovery.

## Features

- **Master/Worker Architecture**: Easily distribute tasks from a central master server to multiple workers.
- **Generic Task Definitions**: Define tasks using TypeScript interfaces, enabling strong typing and flexibility.
- **Pluggable Task Retrieval and Result Handling**: Pass in your own functions to determine how tasks are retrieved and how results are processed.
- **Bonjour Discovery (Optional)**: Seamlessly discover the master server on a local network without manual configuration.
- **Built-In Logging**: Track connections, task distribution, and results with integrated logging.

## How It Works

1. **The Master (Task Distributor)**  
   The master node runs a server that:
   - Provides tasks in batches to connected workers upon request.
   - Receives completed results from workers and processes them via a user-defined callback.
   
2. **The Workers**  
   Each worker:
   - Discovers (or is directed to) the master node.
   - Requests tasks from the master.
   - Processes the tasks using a user-defined function (e.g., scraping, data processing).
   - Sends the results back to the master.
   - Continues requesting new tasks until there are none left.

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

## Usage Example

### Master Node (Task Distributor)

Below is an example of setting up the master node. The master node:
- Instantiates a `TaskDistributor`.
- Supplies a `getTasks` function for retrieving tasks.
- Supplies a `handleResults` function for handling completed tasks.

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

The worker node:
- Tries to discover the master automatically via Bonjour, or you can specify `masterUrl` directly.
- Requests tasks from the master.
- Processes them using a provided `processTasks` function.
- Returns the completed results and requests more tasks until none remain.

```typescript
import { WorkerClient } from './WorkerClient';

// Example task and result interface
interface MyTask {
    word: string;
}

interface MyResult {
    word: string;
    syllableData: any;
}

// Example processing function (replace with your own logic, like web scraping)
async function processMyTasks(tasks: MyTask[]): Promise<MyResult[]> {
    const results: MyResult[] = [];
    for (const task of tasks) {
        // Implement your custom logic here
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

// `scrapeSyllableData(word: string)` should be defined by you
// to perform the actual data fetching logic (e.g., Puppeteer scraping).
```

## Bonjour Discovery

With Bonjour enabled, the worker will automatically find the master on the local network by the specified `serviceType`. If you prefer a static setup, you can skip Bonjour and provide the `masterUrl` directly:

```typescript
const worker = new WorkerClient<MyTask, MyResult>({
    masterUrl: 'http://127.0.0.1:4000', // Direct connection, no Bonjour required
    processTasks: processMyTasks
});
```

## Logging

Both the master and the worker come with a built-in logger using `winston`. Logs are printed to the console and written to `.log` files. You can customize the logger by passing in your own `winston.Logger` instance.

## Error Handling

- The worker and master both log connection errors, missing tasks, and other issues.
- The worker exits gracefully when no more tasks are available.
- You can wrap the logic in try/catch blocks if you want custom shutdown procedures.

## Extending Distributo

**Distributo** is designed to be flexible:

- **Custom Task Shapes**: Just define your own interfaces for tasks and results.
- **Custom Retrieval**: The master can load tasks from files, databases, or APIs.
- **Custom Processing**: The worker can do anything from scraping websites to running ML models.
- **Multiple Workers**: Run multiple worker instances for parallel task processing.

## Contributing

Contributions are welcome! Please submit pull requests with new features or bug fixes, and ensure you run tests and follow the code style guidelines.

## License

This project is released under the MIT License.

---

**Happy distributing!**