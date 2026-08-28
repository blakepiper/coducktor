import { z } from 'zod';
/** Relative path used to select an IDE directory. The empty value means the project root. */
export declare const ideDirectoryQuerySchema: z.ZodObject<{
    path: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Relative path used to select one editable project file. */
export declare const ideFileQuerySchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strict>;
export declare const ideFileInputSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
}, z.core.$strict>;
export type IdeFileInput = z.infer<typeof ideFileInputSchema>;
export declare const ideEntrySchema: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    type: z.ZodEnum<{
        dir: "dir";
        file: "file";
    }>;
    size: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type IdeEntry = z.infer<typeof ideEntrySchema>;
export declare const ideDirectoryResponseSchema: z.ZodObject<{
    path: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
        type: z.ZodEnum<{
            dir: "dir";
            file: "file";
        }>;
        size: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    truncated: z.ZodBoolean;
}, z.core.$strip>;
export type IdeDirectoryResponse = z.infer<typeof ideDirectoryResponseSchema>;
export declare const ideFileResponseSchema: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
    size: z.ZodNumber;
}, z.core.$strip>;
export type IdeFileResponse = z.infer<typeof ideFileResponseSchema>;
