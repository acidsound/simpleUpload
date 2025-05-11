const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
    
// CORS 설정
app.use(cors());

// 타임아웃 설정 증가 (2시간)
app.use(function(req, res, next) {
  res.setTimeout(7200000, function() {
    console.log('요청 타임아웃: ' + req.url);
    res.status(408).send('요청 처리 시간이 초과되었습니다.');
  });
  next();
});

// 요청 본문 크기 제한 늘리기
app.use(express.json({ limit: '5000mb' }));
app.use(express.urlencoded({ limit: '5000mb', extended: true }));

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 업로드 폴더 생성
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 설정 - 대용량 파일 처리를 위한 디스크 스토리지 사용
// Multer 설정 부분 수정
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Multer saves to this directory with a temporary name
  }
  // We remove the `filename` option here to let Multer generate unique temporary names.
  // The actual desired filename will be handled by renaming the file in the route handler.
});

// 파일 크기 제한 없음 (4GB 이상도 가능)
// Multer 설정을 먼저 초기화
const upload = multer({
    storage: storage,
    limits: { fileSize: Infinity }
  });

// 파일 업로드 처리 핸들러 (Non-chunked)
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
  }

  const tempPath = req.file.path; // Multer's temporary file path
  // req.file.originalname should be the UTF-8 filename from Content-Disposition
  let originalClientFileName = req.file.originalname;
  let currentFileName = req.file.originalname;
  try {
    const uriDecodedName = decodeURIComponent(currentFileName);
    // Check if URI decoding actually changed the string or if the original contained percent signs
    if (uriDecodedName !== currentFileName || currentFileName.includes("%")) {
      console.log(`[/upload] originalname URI decoded to: "${uriDecodedName}" (from "${currentFileName}")`);
      currentFileName = uriDecodedName;
    } else {
      console.log(`[/upload] originalname not significantly changed by URI decoding or no '%' found: "${currentFileName}". Attempting latin1 fallback.`);
      // If URI decoding didn't change it (e.g. pure ASCII), try latin1 fallback for non-ASCII
      if (!/^[x00-x7F]*$/.test(currentFileName)) { // Only if not pure ASCII
        const latin1ToUtf8 = Buffer.from(currentFileName, 'latin1').toString('utf8');
        if (currentFileName !== latin1ToUtf8 && !latin1ToUtf8.includes('')) {
          console.log(`[/upload] originalname (no URI change) re-encoded from latin1 to UTF-8: "${latin1ToUtf8}"`);
          currentFileName = latin1ToUtf8;
        }
      }
    }
  } catch (e) {
    console.warn(`[/upload] Error during originalname URI decoding for "${currentFileName}": ${e.message}. Attempting latin1 fallback on original.`);
    try {
        // Fallback to latin1 conversion on the original name if URI decoding failed
        const originalName = req.file.originalname;
        if (!/^[x00-x7F]*$/.test(originalName)) { // Only if not pure ASCII
            const latin1ToUtf8 = Buffer.from(originalName, 'latin1').toString('utf8');
            if (originalName !== latin1ToUtf8 && !latin1ToUtf8.includes('')) {
                console.log(`[/upload] Fallback (after URI decode error): originalname re-encoded from latin1 to UTF-8: "${latin1ToUtf8}"`);
                currentFileName = latin1ToUtf8;
            } else {
                currentFileName = originalName; // Stick to absolute original if latin1 fallback is not better
            }
        } else {
            currentFileName = originalName; // Stick to original if pure ASCII and URI decode failed
        }
    } catch (bufferErr) {
        console.warn(`[/upload] Final fallback Buffer.from latin1 to utf8 also failed for originalname: "${req.file.originalname}". Error: ${bufferErr.message}`);
        currentFileName = req.file.originalname; // Stick to absolute original
    }
  }
  originalClientFileName = currentFileName;
  console.log(`[/upload] Received originalname: ${originalClientFileName}, hex: ${Buffer.from(originalClientFileName, 'utf8').toString('hex')}`);

  const finalPath = path.join(uploadDir, originalClientFileName);

  // Ensure the target directory exists (though Multer should have created uploadDir)
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  fs.rename(tempPath, finalPath, (err) => {
    if (err) {
      console.error(`[/upload] 파일 rename 중 오류 (${tempPath} -> ${finalPath}):`, err);
      fs.unlink(tempPath, (unlinkErr) => { // Attempt to clean up temp file
        if (unlinkErr) console.error(`[/upload] 임시 파일 삭제 중 오류 (${tempPath}):`, unlinkErr);
      });
      return res.status(500).json({ error: '파일 저장 중 서버 오류가 발생했습니다.' });
    }
    console.log(`[/upload] 파일 저장 성공: ${finalPath}`);
    res.json({
      success: true,
      filename: originalClientFileName,
      size: req.file.size,
      path: finalPath
    });
  });
});

// 청크 업로드 핸들러 추가 - express-fileupload 미들웨어 필요
const fileUpload = require('express-fileupload');
app.use(fileUpload()); // express-fileupload 미들웨어 등록

// 엔드포인트 추가: 이미 업로드된 청크 확인
app.get('/check-chunks', (req, res) => {
  const { fileId } = req.query;
  if (!fileId) {
    return res.status(400).json({ error: 'fileId가 필요합니다.' });
  }

  const tempDir = path.join(uploadDir, 'temp', String(fileId));
  if (!fs.existsSync(tempDir)) {
    return res.json({ nextChunk: 0 }); // 임시 폴더가 없으면 처음부터 시작
  }

  try {
    const files = fs.readdirSync(tempDir);
    const chunkNumbers = files
      .filter(file => file.endsWith('.part'))
      .map(file => parseInt(file.replace('.part', '')))
      .sort((a, b) => a - b);

    let nextChunk = 0;
    for (let i = 0; i < chunkNumbers.length; i++) {
      if (chunkNumbers[i] === nextChunk) {
        nextChunk++;
      } else {
        // 중간에 빠진 청크가 있으면, 해당 청크부터 다시 시작 (또는 오류 처리)
        // 여기서는 단순하게 빠진 부분부터 시작하도록 처리 (더 복잡한 로직 가능)
        break;
      }
    }
    console.log(`[/check-chunks] fileId: ${fileId}, existing chunks: ${chunkNumbers.join(',')}, nextChunk: ${nextChunk}`);
    res.json({ nextChunk });
  } catch (error) {
    console.error(`[/check-chunks] 청크 확인 중 오류 (fileId: ${fileId}):`, error);
    res.status(500).json({ error: '청크 확인 중 서버 오류 발생', details: error.message });
  }
});

app.post('/upload-chunk', (req, res) => {
  if (!req.files || !req.files.chunk || !req.body.fileName || !req.body.fileId || req.body.chunkNumber === undefined || req.body.totalChunks === undefined) {
    return res.status(400).json({ error: '필수 파라미터가 누락되었습니다 (chunk, fileName, fileId, chunkNumber, totalChunks).' });
  }

  const { fileId, chunkNumber, totalChunks } = req.body;
  let currentChunkFileName = req.body.fileName; // This is URL-encoded by the client
  try {
    const uriDecodedName = decodeURIComponent(currentChunkFileName);
    console.log(`[/upload-chunk] fileName URI decoded to: "${uriDecodedName}" (from "${currentChunkFileName}")`);
    currentChunkFileName = uriDecodedName;

    // After URI decoding, the result might still be a string that was originally mis-encoded as latin1 on the client before URI encoding.
    // So, attempt latin1 to UTF-8 conversion on the URI-decoded name if it's not pure ASCII.
    if (!/^[x00-x7F]*$/.test(currentChunkFileName)) { // Only if not pure ASCII
        const latin1ToUtf8 = Buffer.from(currentChunkFileName, 'latin1').toString('utf8');
        if (currentChunkFileName !== latin1ToUtf8 && !latin1ToUtf8.includes('')) {
            console.log(`[/upload-chunk] Decoded fileName (after URI decode) re-encoded from latin1 to UTF-8: "${latin1ToUtf8}"`);
            currentChunkFileName = latin1ToUtf8;
        }
    }
  } catch (e) {
    console.error(`[/upload-chunk] CRITICAL: decodeURIComponent failed for fileName: "${currentChunkFileName}". Error: ${e.message}. Using as is (potentially percent-encoded).`);
    // If decodeURIComponent fails, currentChunkFileName remains req.body.fileName (the original URL-encoded string from client)
    // This is problematic as it will likely save with the percent-encoded name.
  }
  clientFileName = currentChunkFileName;
  const chunkFile = req.files.chunk;

  console.log(`[/upload-chunk] Received fileName: ${clientFileName}, hex: ${Buffer.from(clientFileName, 'utf8').toString('hex')}`);
  console.log(`[/upload-chunk] fileId: ${fileId}, chunk: ${chunkNumber}/${parseInt(totalChunks)-1}`);

  const tempDir = path.join(uploadDir, 'temp', String(fileId));
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (mkdirErr) {
      console.error(`[/upload-chunk] 임시 폴더 생성 오류 (${tempDir}):`, mkdirErr);
      return res.status(500).json({ error: '임시 폴더 생성 중 오류가 발생했습니다.' });
    }
  }

  const chunkPath = path.join(tempDir, `${chunkNumber}.part`);
  chunkFile.mv(chunkPath, (err) => {
    if (err) {
      console.error(`[/upload-chunk] 청크 저장 오류 (${chunkPath}):`, err);
      return res.status(500).json({ error: '청크 저장 중 오류가 발생했습니다.' });
    }

    console.log(`[/upload-chunk] 청크 저장 성공: ${chunkPath}`);
    if (parseInt(chunkNumber) === parseInt(totalChunks) - 1) {
      console.log(`[/upload-chunk] 마지막 청크 수신, 병합 시작: ${clientFileName}`);
      mergeChunks(String(fileId), clientFileName, parseInt(totalChunks), res);
    } else {
      res.json({ success: true, message: `Chunk ${chunkNumber} of ${clientFileName} received` });
    }
  });
});

async function mergeChunks(fileId, clientFileName, totalChunks, res) {
  const tempDir = path.join(uploadDir, 'temp', fileId);
  const finalFilePath = path.join(uploadDir, clientFileName);
  console.log(`[mergeChunks] Starting merge for fileId: ${fileId}, clientFileName: ${clientFileName}, totalChunks: ${totalChunks}`);

  const writeStream = fs.createWriteStream(finalFilePath);

  writeStream.on('finish', async () => {
    console.log(`[mergeChunks]WriteStream finished for ${clientFileName}. Cleaning up temp directory: ${tempDir}`);
    try {
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        console.log(`[mergeChunks] Temp directory ${tempDir} deleted successfully.`);
      }
      if (res && !res.headersSent) {
        res.json({ success: true, message: `${clientFileName} uploaded successfully`, filePath: finalFilePath });
      }
    } catch (rmErr) {
      console.error(`[mergeChunks] Error deleting temp directory ${tempDir}:`, rmErr);
      if (res && !res.headersSent) {
        // Still send success if merge was ok but cleanup failed
        res.json({ success: true, message: `${clientFileName} uploaded successfully, but temp folder cleanup issue.`, filePath: finalFilePath });
      }
    }
  });

  writeStream.on('error', (err) => {
    console.error(`[mergeChunks] WriteStream error for ${clientFileName} (Path: ${finalFilePath}):`, err);
    if (res && !res.headersSent) {
      res.status(500).json({ success: false, message: 'Error writing merged file for ' + clientFileName, details: err.message });
    }
    // Attempt to clean up tempDir and partially written final file if stream fails
    fs.promises.rm(tempDir, { recursive: true, force: true }).catch(e => console.error(`[mergeChunks] Error cleaning up temp dir ${tempDir} on stream error:`, e));
    if (fs.existsSync(finalFilePath)) {
        fs.unlink(finalFilePath, (unlinkErr) => {
            if (unlinkErr) console.error(`[mergeChunks] Error deleting partially written file ${finalFilePath} on stream error:`, unlinkErr);
        });
    }
  });

  async function appendChunk(chunkNumber) {
    const chunkPath = path.join(tempDir, `${chunkNumber}.part`);
    if (!fs.existsSync(chunkPath)) {
      console.error(`[mergeChunks] Chunk ${chunkNumber} not found at ${chunkPath} for ${clientFileName}`);
      // Stop merging and signal error
      writeStream.destroy(new Error(`Chunk ${chunkNumber} not found`)); 
      return false;
    }

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(chunkPath);
      readStream.on('error', (err) => {
        console.error(`[mergeChunks] ReadStream error for chunk ${chunkNumber} (${chunkPath}) of ${clientFileName}:`, err);
        reject(err);
      });
      readStream.on('end', () => {
        fs.unlink(chunkPath, (unlinkErr) => { // Delete chunk after successful pipe
          if (unlinkErr) console.warn(`[mergeChunks] Failed to delete chunk ${chunkPath}:`, unlinkErr);
        });
        resolve(true);
      });
      readStream.pipe(writeStream, { end: false });
    });
  }

  try {
    for (let i = 0; i < totalChunks; i++) {
      console.log(`[mergeChunks] Appending chunk ${i} for ${clientFileName}`);
      const success = await appendChunk(i);
      if (!success) {
        // Error already handled by readStream/writeStream error handlers, or chunk not found
        console.error(`[mergeChunks] Failed to append chunk ${i} for ${clientFileName}. Aborting merge.`);
        // Ensure response is sent if not already
        if (res && !res.headersSent) {
             res.status(500).json({ success: false, message: `Failed to append chunk ${i} for ${clientFileName}` });
        }
        return; // Stop processing further chunks
      }
    }
    console.log(`[mergeChunks] All chunks processed for ${clientFileName}. Ending writeStream.`);
    writeStream.end(); // Signal that all chunks have been piped
  } catch (error) {
    console.error(`[mergeChunks] Error during chunk appending loop for ${clientFileName}:`, error);
    writeStream.destroy(error); // Ensure stream is destroyed on loop error
    if (res && !res.headersSent) {
      res.status(500).json({ success: false, message: 'Error merging chunks for ' + clientFileName, details: error.message });
    }
  }
}

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 업로드된 파일 목록 조회
app.get('/files', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: '파일 목록을 불러올 수 없습니다.' });
    }
    
    // temp 폴더 제외하고 파일 목록 생성
    const fileList = files
      .filter(file => file !== 'temp') // temp 폴더 제외
      .map(file => {
        const stats = fs.statSync(path.join(uploadDir, file));
        return {
          name: file,
          size: stats.size,
          date: stats.mtime
        };
      });
    
    res.json(fileList);
  });
});

// 파일 병합 상태 확인
app.get('/check-merge', (req, res) => {
  const { fileId } = req.query;
  if (!fileId) {
    return res.status(400).json({ error: 'fileId가 필요합니다.' });
  }

  const finalFilePath = path.join(uploadDir, decodeURIComponent(fileId.split('_')[0]));
  
  if (fs.existsSync(finalFilePath)) {
    return res.json({ merged: true, message: '파일 병합이 완료되었습니다.' });
  }
  
  // 파일이 아직 존재하지 않으면 병합 중으로 간주
  res.json({ merged: false, message: '파일 병합 중입니다.' });
});

// 부분적으로 업로드된 파일 목록 조회
app.get('/partial-uploads', (req, res) => {
  const tempDir = path.join(uploadDir, 'temp');
  
  if (!fs.existsSync(tempDir)) {
    return res.json([]); // temp 폴더가 없으면 빈 배열 반환
  }
  
  try {
    const fileIds = fs.readdirSync(tempDir);
    const partialUploads = [];
    
    fileIds.forEach(fileId => {
      const fileDir = path.join(tempDir, fileId);
      if (!fs.statSync(fileDir).isDirectory()) return;
      
      const chunks = fs.readdirSync(fileDir)
        .filter(file => file.endsWith('.part'))
        .map(file => parseInt(file.replace('.part', '')))
        .sort((a, b) => a - b);
      
      if (chunks.length > 0) {
        // 파일 정보 추출 (fileId에서 파일명과 크기 추출)
        const lastUnderscoreIndex = fileId.lastIndexOf('_');
        const fileName = decodeURIComponent(fileId.substring(0, lastUnderscoreIndex));
        const fileSize = parseInt(fileId.substring(lastUnderscoreIndex + 1));
        
        // 업로드된 총 크기 계산
        let uploadedSize = 0;
        chunks.forEach(chunkNum => {
          const chunkPath = path.join(fileDir, `${chunkNum}.part`);
          uploadedSize += fs.statSync(chunkPath).size;
        });
        
        partialUploads.push({
          fileId,
          name: fileName,
          totalSize: fileSize,
          uploadedSize,
          progress: Math.round((uploadedSize / fileSize) * 100),
          chunks: chunks.length
        });
      }
    });
    
    res.json(partialUploads);
  } catch (error) {
    console.error('[/partial-uploads] 오류:', error);
    res.status(500).json({ error: '부분 업로드 목록 조회 중 오류 발생' });
  }
});

// 서버 시작
const server = app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log(`업로드 폴더: ${uploadDir}`);
});

// 서버 타임아웃 설정 (2시간)
server.timeout = 7200000;