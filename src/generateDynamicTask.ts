// generateDynamicTaskEnhanced.ts

import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { DynamicTask } from './interface.js';
import { isText } from 'istextorbinary';
import * as ajv from 'ajv';

const readFileAsync = util.promisify(fs.readFile);
const readdirAsync = util.promisify(fs.readdir);
const statAsync = util.promisify(fs.stat);

const ajvInstance = new ajv.Ajv();

// Define JSON schemas for package.json and tsconfig.json
const packageJsonSchema = {
    type: "object",
    properties: {
        name: { type: "string" },
        version: { type: "string" },
        scripts: { type: "object" },
        dependencies: { type: "object" },
        devDependencies: { type: "object" }
    },
    required: ["name", "version", "scripts"],
    additionalProperties: true
};

const tsconfigJsonSchema = {
    type: "object",
    properties: {
        compilerOptions: { type: "object" },
        include: { type: "array", items: { type: "string" } },
        exclude: { type: "array", items: { type: "string" } }
    },
    required: ["compilerOptions"],
    additionalProperties: true
};

const validatePackageJson = ajvInstance.compile(packageJsonSchema);
const validateTsconfigJson = ajvInstance.compile(tsconfigJsonSchema);

/**
 * Recursively collects all files in a directory, excluding specified directories.
 * Supports reading binary files and encoding them in Base64.
 * @param dir - The directory to traverse.
 * @param excludeDirs - Array of directory names to exclude from traversal.
 * @param baseDir - The base directory to calculate relative paths.
 * @returns A promise that resolves to an array of relative file paths.
 */
async function collectFiles(
    dir: string,
    excludeDirs: string[] = ['node_modules', '.git', 'dist'],
    baseDir: string = dir
): Promise<string[]> {
    let filesList: string[] = [];

    const files = await readdirAsync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const relativePath = path.relative(baseDir, fullPath);
        const stats = await statAsync(fullPath);

        if (stats.isDirectory()) {
            if (!excludeDirs.includes(file)) {
                const nestedFiles = await collectFiles(fullPath, excludeDirs, baseDir);
                filesList = filesList.concat(nestedFiles);
            }
        } else if (stats.isFile()) {
            filesList.push(relativePath);
        }
    }

    return filesList;
}

/**
 * Determines the entry point of the project.
 * Priority is given to the "main" field in package.json.
 * If not found, defaults to "src/index.ts".
 * @param packageJson - The parsed package.json content.
 * @returns The entry point file path.
 */
function determineEntryPoint(packageJson: any): string {
    if (packageJson.main) {
        return packageJson.main;
    }

    // Default entry point
    return 'src/index.ts';
}

/**
 * Generates a DynamicTask object by pointing to a project directory.
 * @param projectPath - The path to the project directory.
 * @param options - Optional parameters to override defaults.
 * @returns A promise that resolves to a DynamicTask object.
 */
export async function generateDynamicTask(
    projectPath: string,
    taskType: string,
    options?: {
        type?: string;
        args?: string[];
        env?: Record<string, string>;
        workingDirectory?: string;
        taskId?: string;
        timeout?: number;
        additionalOptions?: Record<string, any>;
    }
): Promise<DynamicTask> {
    // Resolve absolute path
    const absoluteProjectPath = path.resolve(projectPath);

    // Check if the project directory exists
    if (!fs.existsSync(absoluteProjectPath)) {
        throw new Error(`Project directory does not exist: ${absoluteProjectPath}`);
    }

    // Read and parse package.json
    const packageJsonPath = path.join(absoluteProjectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`package.json not found in project directory: ${absoluteProjectPath}`);
    }

    const packageJsonContent = await readFileAsync(packageJsonPath, 'utf-8');
    let packageJson: any;
    try {
        packageJson = JSON.parse(packageJsonContent);
    } catch (error: any) {
        throw new Error(`Failed to parse package.json: ${error.message}`);
    }

    // Validate package.json
    if (!validatePackageJson(packageJson)) {
        throw new Error(`Invalid package.json: ${ajvInstance.errorsText(validatePackageJson.errors)}`);
    }

    // Read and parse tsconfig.json
    const tsconfigJsonPath = path.join(absoluteProjectPath, 'tsconfig.json');
    if (!fs.existsSync(tsconfigJsonPath)) {
        throw new Error(`tsconfig.json not found in project directory: ${absoluteProjectPath}`);
    }

    const tsconfigJsonContent = await readFileAsync(tsconfigJsonPath, 'utf-8');
    let tsconfigJson: any;
    try {
        tsconfigJson = JSON.parse(tsconfigJsonContent);
    } catch (error: any) {
        throw new Error(`Failed to parse tsconfig.json: ${error.message}`);
    }

    // Validate tsconfig.json
    if (!validateTsconfigJson(tsconfigJson)) {
        throw new Error(`Invalid tsconfig.json: ${ajvInstance.errorsText(validateTsconfigJson.errors)}`);
    }

    // Collect all source and ancillary files, excluding node_modules, .git, dist, etc.
    const allFiles = await collectFiles(absoluteProjectPath);

    // Read all files and construct the files record
    const filesRecord: { [key: string]: string } = {};

    for (const relativeFilePath of allFiles) {
        const fullFilePath = path.join(absoluteProjectPath, relativeFilePath);
        const fileBuffer = fs.readFileSync(fullFilePath);

        // Use istextorbinary to determine if the file is binary
        const isBinary = !isText(null, fileBuffer);
        let fileContent: string = isBinary ? fileBuffer.toString('base64') : fileBuffer.toString('utf-8');

        // Normalize file paths to use forward slashes
        const normalizedPath = relativeFilePath.split(path.sep).join('/');
        filesRecord[normalizedPath] = fileContent;
    }

    // Determine the entry point
    let entryPoint = determineEntryPoint(packageJson);
    // If entryPoint does not have a .ts or .tsx extension, attempt to find one
    if (!/\.(ts|tsx)$/.test(entryPoint)) {
        const tsEntryPoint = `${entryPoint}.ts`;
        const tsxEntryPoint = `${entryPoint}.tsx`;
        if (filesRecord[tsEntryPoint]) {
            entryPoint = tsEntryPoint;
        } else if (filesRecord[tsxEntryPoint]) {
            entryPoint = tsxEntryPoint;
        }
    }

    // Verify that the entryPoint exists

    if (!filesRecord[entryPoint]) {
        if (!entryPoint.startsWith("dist")) {
            throw new Error(`Entry point file not found: ${entryPoint}`);
        }
    }

    // Assemble the DynamicTask object
    const dynamicTask: DynamicTask = {
        type: options?.type || 'executeCode',
        taskType: taskType,
        packageJson: packageJson,
        tsconfigJson: tsconfigJson,
        files: filesRecord,
        entryPoint: entryPoint,
        args: options?.args,
        env: options?.env,
        workingDirectory: options?.workingDirectory,
        taskId: options?.taskId,
        timeout: options?.timeout,
        options: options?.additionalOptions
    };

    return dynamicTask;
}
