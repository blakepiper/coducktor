export declare const IDE_FILE_MAX_BYTES = 1000000;
type IdeErrorStatus = 400 | 404 | 409;
export type IdeResult<T> = {
    ok: true;
    body: T;
} | {
    ok: false;
    status: IdeErrorStatus;
    error: string;
};
export interface IdeDirectoryBody {
    path: string;
    entries: Array<{
        name: string;
        path: string;
        type: 'dir' | 'file';
        size?: number;
    }>;
    truncated: boolean;
}
export interface IdeFileBody {
    path: string;
    content: string;
    size: number;
}
export declare function listIdeDirectory(root: string, path?: string): Promise<IdeResult<IdeDirectoryBody>>;
export declare function readIdeFile(root: string, path: string): Promise<IdeResult<IdeFileBody>>;
export declare function writeIdeFile(root: string, path: string, content: string): Promise<IdeResult<IdeFileBody>>;
export {};
