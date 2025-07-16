const uploadInput = document.getElementById('upload');
const downloadButton = document.getElementById('download');
const progressBar = document.getElementById('progress');
const percentDisplay = document.getElementById('percent');
const logDiv = document.getElementById('log');

let zipBlob = null;
let outputFileName = '';

uploadInput.addEventListener('change', handleFileUpload);
downloadButton.addEventListener('click', () => {
  if (zipBlob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = outputFileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  log(`
📁 开始处理Mod: ${file.name}`);
  updateProgress(0);
  downloadButton.disabled = true;

  try {
    const zip = await JSZip.loadAsync(file);
    log('✅ Mod已加载');

    const langFilePath = await findLangFile(zip);
    if (!langFilePath) {
      log('❌ 未找到语言文件');
      return;
    }

    log(`🌐 找到语言文件: ${langFilePath}`);

    const isJson = langFilePath.endsWith('.json');
    const raw = await zip.file(langFilePath).async('string');
    const translations = isJson ? JSON.parse(raw) : parseLang(raw);

    const keys = Object.keys(translations);
    const keyPartsMap = {};
    keys.forEach(k => keyPartsMap[k] = splitParts(translations[k]));

    let tasks = [];
    keys.forEach(key => {
      keyPartsMap[key].forEach((part, idx) => {
        if (part.translate) tasks.push({ key, idx, text: part.text });
      });
    });

    const total = tasks.length;
    updateProgress(0);
    log(`📦 总共需要翻译 ${total} 条文本`);

    const concurrency = 10;
    let results = [];
    for (let i = 0; i < total; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const translated = await Promise.all(batch.map(t => translate(t.text)));
      translated.forEach((result, idx) => {
        const input = batch[idx].text;
        log(`已成功将 ${input} 翻译为 ${result.textOnly}`);
        results.push(result.textOnly || input);
      });
      updateProgress(Math.min(100, Math.round((results.length / total) * 100)));
    }

    let pointer = 0;
    const zhMap = {};
    keys.forEach(key => {
      const parts = keyPartsMap[key];
      zhMap[key] = parts.map(p => p.translate ? results[pointer++] : p.text).join('');
    });

    const newContent = isJson
      ? JSON.stringify(zhMap, null, 2)
      : generateLang(zhMap);

    const dir = langFilePath.substring(0, langFilePath.lastIndexOf('/'));
    const newPath = `${dir}/zh_cn.${isJson ? 'json' : 'lang'}`;
    zip.file(newPath, newContent);
    log(`已生成 zh_cn 语言文件: ${newPath}`);

    log('🛠️ 正在打包新文件，请稍候...');
    zip.generateAsync({ type: 'blob' }, meta => {
      updateProgress(Math.round(meta.percent));
    }).then(blob => {
      zipBlob = blob;
      outputFileName = 'translated_' + file.name;
      downloadButton.disabled = false;
      log('✅ 构建完成，可点击“下载汉化后的mod”获取结果');
    });

  } catch (err) {
    log(`❗ 错误: ${err.message}`);
  }
}

function log(msg) {
  logDiv.textContent += msg + '\n';
  logDiv.scrollTop = logDiv.scrollHeight;
}

function updateProgress(percent) {
  progressBar.value = percent;
  percentDisplay.textContent = `${percent}%`;
}

function parseLang(content) {
  return content.split('\n').reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (v.length) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});
}

function generateLang(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
}

function splitParts(text) {
  const parts = [];
  const regex = /(%\d+\$[ds]|%\d*[ds]|§.)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.substring(lastIndex, match.index), translate: true });
    }
    parts.push({ text: match[0], translate: false });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.substring(lastIndex), translate: true });
  }
  return parts;
}

async function translate(input) {
  const sanitizedInput = input.replace(/[\r\n]+/g, ' ');
  for (let i = 0; i < 3; i++) {
    try {
      const url = `https://v.api.aa1.cn/api/api-fanyi-yd/index.php?msg=${encodeURIComponent(sanitizedInput)}&type=3`;
      const res = await fetch(url);
      const txt = await res.text();
      const json = JSON.parse(txt);
      if (json.text) {
        return { raw: json, textOnly: json.text };
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return { raw: {}, textOnly: null };
}

async function findLangFile(zip) {
  let files = zip.file(/^assets\/[^\/]+\/lang\/en_us\.(lang|json)$/);
  if (files.length > 0) return files[0].name;
  files = zip.file(/assets\/[^\/]+\/lang\/en_us\.(lang|json)$/);
  if (files.length > 0) return files[0].name;
  return null;
}

const rightPane = document.getElementById('log-container');

uploadInput.addEventListener('change', () => {
  if (uploadInput.files.length > 0) {
    rightPane.classList.add('expanded');
  }
});