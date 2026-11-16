const file='knowledge-hint.json';

export async function readKnowledgeHint(storage){
 try{
  const raw=await storage.read('config',file);
  return {dismissed:raw!=null&&JSON.parse(raw).dismissed===true};
 }catch(error){throw Error(`读取知识库提示设置失败，请重试：${error.message}`,{cause:error})}
}

export async function dismissKnowledgeHint(storage){
 try{await storage.write('config',file,JSON.stringify({dismissed:true}))}
 catch(error){throw Error(`关闭设置保存失败，提示尚未永久关闭，请重试：${error.message}`,{cause:error})}
 return {dismissed:true};
}
