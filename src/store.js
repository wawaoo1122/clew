// Local JSON storage. Everything lives in one file under the app's data folder,
// plus an images/ folder for screenshots.
const fs = require('fs');
const path = require('path');

const PROVIDERS = {
  mimo: { label: 'MiMo (Xiaomi)', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  kimi: { label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }
};

function defaultSettings() {
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    providers[id] = { baseUrl: p.baseUrl, model: p.model, keyEnc: '', keyPlain: '', status: 'untested', message: '' };
  }
  return { providers, roles: { brain: null, eyes: null }, lateDays: 30, minTopic: 3 };
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'clew-data.json');
    this.imgDir = path.join(dir, 'images');
    fs.mkdirSync(this.imgDir, { recursive: true });
    this.load();
  }

  load() {
    let data = null;
    if (fs.existsSync(this.file)) {
      try {
        data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (e) {
        // Keep the broken file instead of silently overwriting it.
        fs.renameSync(this.file, this.file + '.broken-' + Date.now());
      }
    }
    if (!data) data = { version: 1, items: [], topics: [], chains: [], reminders: [], settings: defaultSettings() };
    // Fill in anything missing from older files.
    const d = defaultSettings();
    data.settings = Object.assign({}, d, data.settings || {});
    data.settings.providers = Object.assign({}, d.providers, data.settings.providers || {});
    for (const id of Object.keys(PROVIDERS)) {
      data.settings.providers[id] = Object.assign({}, d.providers[id], data.settings.providers[id] || {});
    }
    data.settings.roles = Object.assign({}, d.roles, data.settings.roles || {});
    for (const k of ['items', 'topics', 'chains', 'reminders']) if (!Array.isArray(data[k])) data[k] = [];
    // Anything that was mid-processing when the app closed gets retried.
    for (const it of data.items) if (it.status === 'processing') it.status = 'queued';
    this.data = data;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  item(id) { return this.data.items.find((x) => x.id === id); }
  topic(id) { return this.data.topics.find((x) => x.id === id); }
  chain(id) { return this.data.chains.find((x) => x.id === id); }
}

module.exports = { Store, PROVIDERS, defaultSettings, uid };
