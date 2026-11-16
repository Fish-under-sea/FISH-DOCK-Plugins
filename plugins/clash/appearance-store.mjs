// Clash 外观的存取：落在插件自己的 config 分类（appearance.json）。
//
// 三条硬约束，与 Clash 其余配置一致：
//   1. 读永不抛错——配置缺失、损坏、被手改成别的形状，都回落到「不透明默认」，
//      页面照常打开；只有写失败才报 APPEARANCE_SAVE_FAILED。
//   2. 写是整份覆盖、原子语义由宿主 storage 保证；不做部分写入。
//   3. 壁纸体积大且是二进制，单独一条命令，明确成功或失败，绝不静默截断。
//
// 本文件不 import DOM，也不直接碰 fs：storage 由调用方注入，单测给假实现。
import {normalize, patch, isWallpaper, WALLPAPER_LIMIT} from './appearance.mjs';
import {serviceError} from '../../shared/errors.mjs';

export const STORAGE_CATEGORY = 'config';
export const STORAGE_NAME = 'appearance.json';

async function readRaw(storage) {
 try {
  const stored = await storage.read(STORAGE_CATEGORY, STORAGE_NAME);
  if (stored == null) return null;
  const text = typeof stored === 'string' ? stored : Buffer.isBuffer(stored) ? stored.toString('utf8') : String(stored);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
 } catch {
  // 损坏或不可读：当作没有。日志由调用方决定，页面不因此打不开。
  return null;
 }
}

async function writeRaw(storage, value) {
 try {
  await storage.write(STORAGE_CATEGORY, STORAGE_NAME, JSON.stringify(value));
 } catch (error) {
  const failure = serviceError('APPEARANCE_SAVE_FAILED');
  failure.cause = error;
  throw failure;
 }
}

// read 返回当前外观（永远是合法形状）。
export async function readAppearance(storage) {
 return normalize(await readRaw(storage));
}

// savePatch 只接受页面的增量（遮挡度 + 三个区域坐标），壁纸不在其中。
export async function savePatch(storage, change) {
 const next = patch(await readAppearance(storage), change);
 await writeRaw(storage, next);
 return next;
}

// saveWallpaper 设或清壁纸。data 是完整 data URL；remove 为 true 时清空。
export async function saveWallpaper(storage, {data, remove} = {}) {
 const current = await readAppearance(storage);
 if (remove === true) {
  const next = {...current, wallpaper: ''};
  await writeRaw(storage, next);
  return next;
 }
 if (typeof data === 'string' && data.length > 0 && !isWallpaper(data)) {
  throw serviceError('APPEARANCE_WALLPAPER_INVALID');
 }
 const next = {...current, wallpaper: data || ''};
 await writeRaw(storage, next);
 return next;
}

export {WALLPAPER_LIMIT};
