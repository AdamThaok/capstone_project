// Accepts single-file (legacy) OR multi-file input and returns both as arrays,
// so each stage can just work with arrays. Used by stage0 + stage1.

export function getFileArrays(input: {
    filenames?: string[];
    filePaths?: string[];
    filename?:  string;
    filePath?:  string;
}): { filenames: string[]; filePaths: string[] } {
    let filenames: string[] = [];
    if (input.filenames && input.filenames.length > 0) {
        filenames = input.filenames;
    } else if (input.filename) {
        filenames = [input.filename];
    }

    let filePaths: string[] = [];
    if (input.filePaths && input.filePaths.length > 0) {
        filePaths = input.filePaths;
    } else if (input.filePath) {
        filePaths = [input.filePath];
    }

    return { filenames, filePaths };
}
