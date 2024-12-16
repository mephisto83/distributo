// executeDynamicTask.ts

import { NodeVM } from 'vm2';
import * as fs from 'fs';
import * as path from 'path';
import { DynamicTask } from './interface.js';
import EventEmitter from 'events';
/**
 * Executes the DynamicTask within a NodeVM sandbox.
 * @param task - The DynamicTask object.
 * @returns The execution result, including logs and status.
 */
export async function executeDynamicTask(task: DynamicTask): Promise<any> {
    const {
        entryPoint,
        args,
        env,
        workingDirectory,
        taskId,
        timeout,
    } = task;

    // Define the project directory
    const projectDir = workingDirectory || path.join(__dirname, 'tasks', taskId || 'default-task');

    const compiledEntryPoint = path.join(projectDir, entryPoint.replace('.ts', '.js'));

    if (!fs.existsSync(compiledEntryPoint)) {
        throw new Error(`Compiled entry point not found: ${compiledEntryPoint}`);
    }

    const compiledCode = fs.readFileSync(compiledEntryPoint, 'utf-8');
    // Host API methods
    let output = null;

    const eventEmitter = new EventEmitter();

    const hostAPI = {
        output: (data: any) => {
            // Handle the data sent from the VM
            eventEmitter.emit('result', data);
            // You can store it, process it, etc.
        }
    };

    // Set up the NodeVM sandbox
    const vm = new NodeVM({
        console: 'redirect', // Capture console outputs
        sandbox: {
            api: hostAPI,// Inject the API object
            process: {
                env: env || {},
                argv: args || []
            },
            args: args || []
        },
        require: {
            external: true,
            builtin: ['*'], // Grant full access; consider restricting for security
            root: projectDir,
            mock: {}
        },
        wrapper: 'commonjs',
        timeout: timeout || 10000 // Default to 10 seconds
    });

    // Capture console outputs
    const logs: string[] = [];
    vm.on('console.log', (msg) => {
        logs.push(`LOG: ${msg}`);
    });
    vm.on('console.error', (msg) => {
        logs.push(`ERROR: ${msg}`);
    });
    vm.on('console.output', (msg) => {
        logs.push(msg);
    })
    let waitResolve: any = null;
    let waitForResult = new Promise((resolve) => {
        waitResolve = resolve;
    })
    eventEmitter.on('result', (data: any) => {
        output = data;
        waitResolve(output)
    })
    // Execute the compiled code
    try {
        console.log(`Executing the code for task ${taskId || 'default-task'}...`);
        const result = vm.run(compiledCode, compiledEntryPoint);
        // If the entry point exports a promise, await it
        if (result && typeof result.then === 'function') {
            await result;
        }
        await waitForResult;
        console.log('Code executed successfully.');
    } catch (error) {
        console.error('Error during code execution:', error);
        return { success: false, error: 'Execution failed.', details: error, logs };
    }

    return { success: true, logs, output };
}
