# Resumable File Upload Server with Korean Filename Support

This document outlines the requirements and implementation steps to create a Node.js Express server that supports resumable file uploads, handles large files, and correctly processes Korean filenames.

## Core Requirements

1.  **File Upload (Non-Chunked):**
    *   Support standard single file uploads.
    *   Correctly handle and save files with Korean characters in their names (UTF-8 encoding).
    *   Use `multer` for handling `multipart/form-data`.
2.  **Resumable Chunked File Upload:**
    *   Support uploading large files in smaller chunks.
    *   Allow uploads to be paused and resumed.
    *   Generate a unique `fileId` for each file (based on filename and size) to track chunks across sessions.
    *   Implement a `/check-chunks` endpoint for the client to determine which chunks have already been uploaded.
    *   Implement an `/upload-chunk` endpoint to receive and save individual file chunks.
    *   Merge chunks into the final file once all are received.
    *   Clean up temporary chunk files after successful merging.
    *   Correctly handle and save final merged files with Korean characters in their names.
3.  **Server Configuration:**
    *   Use Express.js framework.
    *   Enable CORS.
    *   Increase server timeout and request body size limits to accommodate large file uploads.
    *   Serve a static `index.html` for client-side interaction.
    *   Provide an endpoint (`/files`) to list uploaded files.
    *   Provide instructions for exposing the server externally via SSH tunnel (password automation not supported; manual entry required).
4.  **Client-Side (`index.html`):**
    *   Provide a user interface for selecting and uploading files.
    *   Implement logic for both standard and chunked uploads.
    *   For chunked uploads:
        *   Generate `fileId`.
        *   Call `/check-chunks` before starting/resuming an upload.
        *   Send chunks sequentially to `/upload-chunk`.
        *   Encode filenames using `encodeURIComponent` before sending to the server in chunked uploads.
        *   Display upload progress.
        *   Handle upload completion and errors.
    *   Refresh file list after successful uploads.

## Exposing the Server Externally (SSH Tunnel)

To access the server from outside your local network, use the following SSH tunnel command. Password automation is not supported; you must enter the password manually in the terminal:

```bash
ssh -p 443 -R0:127.0.0.1:3000 qr@free.pinggy.io
```

## Key Implementation Details & Libraries

*   **Node.js & Express.js**: Backend framework.
*   **`multer`**: Middleware for handling `multipart/form-data`, used for non-chunked uploads. Configure to use disk storage and let Multer generate temporary names, then rename to the correct client-provided filename.
*   **`express-fileupload`**: Middleware for handling file uploads, particularly useful for easily accessing uploaded chunks in the `/upload-chunk` route.
*   **`cors`**: Middleware to enable Cross-Origin Resource Sharing.
*   **`fs` (File System module)**: For file operations (creating directories, renaming, reading, writing streams, deleting).
*   **`path`**: For handling and transforming file paths.

### Server-Side (`server.js`)

1.  **Setup Express App:** Basic setup, port, CORS, static file serving, increased timeouts and body limits.
2.  **Upload Directory:** Create an `uploads` directory and a `uploads/temp` subdirectory for chunks.
3.  **Non-Chunked Upload (`/upload`):**
    *   Use `multer.single('file')`.
    *   **Filename Decoding:**
        *   Get `req.file.originalname`.
        *   Attempt `decodeURIComponent()`.
        *   If the name wasn't percent-encoded or `decodeURIComponent` didn't change it significantly, and the name isn't pure ASCII, attempt a `Buffer.from(name, 'latin1').toString('utf8')` conversion as a fallback for potential misinterpretations.
        *   Handle errors during decoding gracefully.
    *   Rename the temporary file (saved by Multer) to the correctly decoded `originalClientFileName` in the `uploads` directory.
4.  **Check Chunks (`/check-chunks` - GET):**
    *   Input: `fileId` (query parameter).
    *   Logic: Read the `uploads/temp/{fileId}` directory, list `.part` files, sort them by chunk number, and determine the `nextChunk` number the client should send.
    *   Output: `{ nextChunk: number }`.
5.  **Upload Chunk (`/upload-chunk` - POST):**
    *   Input: `chunk` (file data), `fileName` (URL-encoded original filename), `fileId`, `chunkNumber`, `totalChunks` (form data).
    *   Use `express-fileupload` middleware.
    *   **Filename Decoding for `clientFileName` (used for final merged file):**
        *   Get `req.body.fileName` (which client sends as `encodeURIComponent(file.name)`).
        *   Apply `decodeURIComponent()`.
        *   If the decoded name isn't pure ASCII, attempt a `Buffer.from(decodedName, 'latin1').toString('utf8')` conversion as a fallback.
    *   Save the received chunk to `uploads/temp/{fileId}/{chunkNumber}.part`.
    *   If `chunkNumber` is the last chunk, call `mergeChunks`.
6.  **Merge Chunks (`mergeChunks` function):**
    *   Input: `fileId`, `clientFileName` (decoded), `totalChunks`, `res` (response object).
    *   Create a `WriteStream` to `uploads/{clientFileName}`.
    *   Iterate from chunk 0 to `totalChunks - 1`:
        *   Create a `ReadStream` for `uploads/temp/{fileId}/{i}.part`.
        *   Pipe `ReadStream` to `WriteStream` (with `{ end: false }`).
        *   Delete the chunk file (`.part`) after successful piping.
        *   Handle errors during read/write operations.
    *   After all chunks are piped, `end()` the `WriteStream`.
    *   On `WriteStream` 'finish' event, delete the temporary directory `uploads/temp/{fileId}` and send success response.
    *   On `WriteStream` 'error' event, attempt cleanup and send error response.
7.  **List Files (`/files` - GET):** Read `uploads` directory and return list of files with names, sizes, and modification dates.

### Client-Side (`public/index.html`)

1.  **File Input & Upload Button.**
2.  **File List Display.**
3.  **`handleFiles` function:** Determines whether to use `uploadFile` (small files) or `uploadInChunks` (large files, e.g., > 10MB).
4.  **`uploadFile` function (for non-chunked):** Uses `FormData` to send the file to `/upload`.
5.  **`uploadInChunks` function:**
    *   **`fileId` Generation:** Create a unique ID, e.g., `${file.name.replace(/[^a-zA-Z0-9]/g, '')}-${file.size}`.
    *   **Call `/check-chunks`:** Send `GET` request with `fileId` (URL-encoded) to get `startChunk`.
    *   **Loop and Upload:** Iterate from `startChunk` to `totalChunks - 1`.
        *   Slice the file to get the current chunk.
        *   Create `FormData` with `chunk`, `fileName` (using `encodeURIComponent(file.name)`), `fileId`, `chunkNumber`, `totalChunks`.
        *   Send `POST` request to `/upload-chunk`.
        *   Update progress bar.
    *   Handle success (all chunks uploaded, server merged) and errors.
6.  **Progress Display & Status Messages.**
7.  **`loadFileList` function:** Fetches and displays files from `/files` endpoint.

## Error Handling & Edge Cases

*   Ensure robust error handling on both client and server for network issues, file system errors, and invalid requests.
*   Handle cases where temporary directories or chunk files might not exist as expected.
*   Properly clean up temporary files and directories, especially after errors.
*   Consider security implications (e.g., validating `fileId`, `chunkNumber`).

This summary provides a comprehensive guide to rebuilding the resumable file upload server with the discussed features.
