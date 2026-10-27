import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {magpieEnvironment} from './environment.mjs';

test('发现使用真实用户目录及 Agent 自定义路径，不继承密钥和 Node 注入变量',()=>{
 const source={USERPROFILE:path.resolve('fixture/user'),HOME:path.resolve('fixture/home'),APPDATA:path.resolve('fixture/roaming'),LOCALAPPDATA:path.resolve('fixture/local'),DSH_HOME:path.resolve('fixture/dsh-custom'),CODEX_HOME:path.resolve('fixture/codex-custom'),CLAUDE_CONFIG_DIR:path.resolve('fixture/claude-custom'),XDG_CONFIG_HOME:path.resolve('fixture/xdg'),Path:'fixture-bin',NODE_OPTIONS:'--require bad.js',OPENAI_API_KEY:'must-not-copy',GITHUB_TOKEN:'must-not-copy',MAGPIE_ADDR:'0.0.0.0:1'};
 const options={home:path.resolve('plugin/profile'),credentials:path.resolve('plugin/credentials'),config:path.resolve('plugin/config'),cache:path.resolve('plugin/tmp'),key:'runtime-key'};
 const env=magpieEnvironment(options,source);
 for(const name of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA','DSH_HOME','CODEX_HOME','CLAUDE_CONFIG_DIR','XDG_CONFIG_HOME']) assert.equal(env[name],source[name],name);
 assert.equal(env.PATH,source.Path);
 assert.equal(env.TEMP,options.cache);assert.equal(env.TMP,options.cache);assert.equal(env.MAGPIE_WEB_KEY,options.key);
 for(const name of ['NODE_OPTIONS','OPENAI_API_KEY','GITHUB_TOKEN','MAGPIE_ADDR']) assert.equal(env[name],undefined,name);
 assert.equal(source.MAGPIE_ADDR,'0.0.0.0:1');
});

test('没有 XDG 覆盖时保持未设置，让 Agent 按真实 home 解析默认目录',()=>{
 const env=magpieEnvironment({cache:path.resolve('plugin/tmp'),key:'test'}, {USERPROFILE:path.resolve('real-user'),HOME:path.resolve('real-home')});
 assert.equal(env.XDG_CONFIG_HOME,undefined);assert.equal(env.XDG_CACHE_HOME,undefined);
 assert.equal(env.USERPROFILE,path.resolve('real-user'));
});

test('保留显式 Bun 依赖路径（含中文空格），不复制其他 Magpie 控制及秘密变量',()=>{
 const bun=path.resolve('测试 runtime/bun.exe');
 const env=magpieEnvironment({cache:'tmp',key:'test'},{magpie_bun:bun,MAGPIE_PUBLIC_URL:'https://untrusted.test',MAGPIE_WEB_KEY:'not-this-key',MAGPIE_GITHUB_TOKEN:'secret'});
 assert.equal(env.MAGPIE_BUN,bun);
 assert.equal(env.MAGPIE_PUBLIC_URL,undefined);assert.equal(env.MAGPIE_GITHUB_TOKEN,undefined);assert.equal(env.MAGPIE_WEB_KEY,'test');
});
