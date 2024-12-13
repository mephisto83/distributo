// setupDynamicTask.ts

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { DynamicTask } from './interface.js';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/**
 * Computes a SHA256 hash of the provided data.
 * @param data - The data to hash.
 * @returns The hexadecimal representation of the hash.
 */
function computeHash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Collects relevant files for hashing (excluding node_modules, .git, dist, etc.).
 * @param files - The files record from DynamicTask.
 * @returns A concatenated string of file paths and contents.
 */
function getHashableContent(files: Record<string, string>): string {
    // Sort the file paths to ensure consistent hashing
    const sortedPaths = Object.keys(files).sort();
    let content = '';

    for (const filePath of sortedPaths) {
        content += filePath + '\n' + files[filePath] + '\n';
    }

    return content;
}

/**
 * Sets up the DynamicTask by writing files, installing dependencies, and building the project.
 * Reinstalls and rebuilds only if changes are detected.
 * @param task - The DynamicTask object.
 * @returns A promise that resolves when setup is complete.
 */
export async function setupDynamicTask(task: DynamicTask): Promise<void> {
    const {
        packageJson,
        tsconfigJson,
        files,
        entryPoint,
        workingDirectory,
        taskId,
    } = task;

    // Define the project directory
    const projectDir = workingDirectory || path.join(__dirname, 'tasks', taskId || 'default-task');

    // Path to store the hash
    const hashFilePath = path.join(projectDir, '.task_hash');

    // Create the project directory if it doesn't exist
    fs.mkdirSync(projectDir, { recursive: true });

    // Write all project files
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = path.join(projectDir, relativePath);
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });

        const isBinary = /\.(png|jpg|jpeg|gif|svg|ico|pdf)$/.test(fullPath);

        if (isBinary) {
            // Decode Base64 content for binary files
            const buffer = Buffer.from(content, 'base64');
            fs.writeFileSync(fullPath, buffer);
        } else {
            // Write text content
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    // Write package.json and tsconfig.json explicitly
    fs.writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify(packageJson, null, 2),
        'utf-8'
    );

    fs.writeFileSync(
        path.join(projectDir, 'tsconfig.json'),
        JSON.stringify(tsconfigJson, null, 2),
        'utf-8'
    );

    // Calculate current hash
    const currentContent = getHashableContent(files);
    const currentHash = computeHash(currentContent);

    // Read previous hash if exists
    let previousHash = '';
    if (fs.existsSync(hashFilePath)) {
        previousHash = fs.readFileSync(hashFilePath, 'utf-8');
    }

    // Determine if changes have occurred
    const hasChanges = currentHash !== previousHash;

    if (hasChanges) {
        console.log(`Changes detected for task ${taskId || 'default-task'}. Installing dependencies and building...`);

        try {
            // Install dependencies
            console.log('Installing dependencies...');
            await execAsync('npm install', { cwd: projectDir });
            console.log('Dependencies installed.');

            // Build the project
            console.log('Building the project...');
            await execAsync('npm run build', { cwd: projectDir });
            console.log('Project built successfully.');

            // Update the hash file
            fs.writeFileSync(hashFilePath, currentHash, 'utf-8');
            console.log('Hash updated.');
        } catch (error) {
            console.error('Error during setup:', error);
            throw new Error('Setup failed.');
        }
    } else {
        console.log(`No changes detected for task ${taskId || 'default-task'}. Skipping install and build.`);
    }
}
