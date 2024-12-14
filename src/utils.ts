import * as fs from "fs";
import * as path from "path";

/**
 * Ensures that a directory exists. If it does not exist, it is created.
 *
 * @param dirPath - The path to the directory to ensure.
 */
export function ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Directory created: ${dirPath}`);
    } else {
        console.log(`Directory already exists: ${dirPath}`);
    }
}

export function writeObjectToFileLineSync(filePath: string, obj: any): void {
    try {
        // Serialize the object as a JSON string
        const jsonString = JSON.stringify(obj);

        // Append the serialized object to the file as a new line
        fs.appendFileSync(filePath, `${jsonString}\n`, { encoding: 'utf-8' });

        console.log('Object written to file:', obj);
    } catch (error) {
        console.error('Error writing object to file:', error);
        throw error;
    }
}

export function readFileIntoArraySync<T>(filePath: string): T[] {
    try {
      // Read the file synchronously
      const fileContent = fs.readFileSync(filePath, { encoding: 'utf-8' });
  
      // Split the content by newlines and parse each line as JSON
      const lines = fileContent.trim().split('\n');
      const result = lines.map((line) => JSON.parse(line));
  
      return result;
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  }