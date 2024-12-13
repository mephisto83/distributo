export interface DynamicTask {
    /**
     * Type of the task. Can be used to distinguish between different task handlers.
     * Example: "executeCode"
     */
    type: string;
    taskType: string; // New property to specify the task category

    /**
     * The contents of the package.json file as a JSON object.
     * Defines project dependencies, scripts, and other configurations.
     */
    packageJson: object;

    /**
     * The contents of the tsconfig.json file as a JSON object.
     * Configures the TypeScript compiler options.
     */
    tsconfigJson: object;

    /**
     * A record of file paths to their respective content.
     * Includes all source code files required for the project.
     * Example:
     * {
     *   "src/index.ts": "import { ... }",
     *   "src/utils.ts": "export const ...",
     *   "README.md": "# Project Title"
     * }
     */
    files: Record<string, string>;

    /**
     * The entry point of the application.
     * Specifies the main TypeScript file to compile and execute.
     * Example: "src/index.ts"
     */
    entryPoint: string;

    /**
     * Optional command-line arguments to pass to the application upon execution.
     * Example: ["--env=production", "--verbose"]
     */
    args?: string[];

    /**
     * Optional environment variables to set for the execution environment.
     * Example: { "API_KEY": "12345", "NODE_ENV": "production" }
     */
    env?: Record<string, string>;

    /**
     * Optional working directory where the code should be written and executed.
     * If not provided, a temporary directory will be used.
     * Example: "/home/user/projects/task123"
     */
    workingDirectory?: string;

    /**
     * Optional unique identifier for the task.
     * Useful for tracking and logging purposes.
     * Example: "task-abc-123"
     */
    taskId?: string;

    /**
     * Optional timeout in milliseconds for the entire task execution.
     * Prevents tasks from running indefinitely.
     * Example: 30000 (30 seconds)
     */
    timeout?: number;

    /**
     * Optional flags or settings for additional configurations.
     * Can be used to pass custom options as needed.
     * Example: { "useDocker": true }
     */
    options?: Record<string, any>;
}
