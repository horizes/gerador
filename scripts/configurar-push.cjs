/* Execute com Node.js. Chaves são geradas fora da pasta pública do site. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const pasta=process.argv[2]?path.resolve(process.argv[2]):path.join(process.env.LOCALAPPDATA||os.homedir(),'Imperium','configuracao-push');
const envFile=path.join(pasta,'push.env'),sqlFile=path.join(pasta,'push-agendamento.sql');
if(fs.existsSync(envFile)){
 console.error('Já existem chaves em '+envFile+'. Reutilize esse arquivo. Trocar VAPID exige reativar os aparelhos.');process.exitCode=1;
}else{
 fs.mkdirSync(pasta,{recursive:true,mode:0o700});
 const ecdh=crypto.createECDH('prime256v1');ecdh.generateKeys();
 const publico=ecdh.getPublicKey().toString('base64url'),privado=Buffer.from(ecdh.getPrivateKey().toString('hex').padStart(64,'0'),'hex').toString('base64url');
 const segredo=crypto.randomBytes(32).toString('hex');
 fs.writeFileSync(envFile,`VAPID_PUBLIC_KEY=${publico}\nVAPID_PRIVATE_KEY=${privado}\nVAPID_SUBJECT=mailto:wilson.cyriaco@imperiumservicos.com\nPUSH_DISPATCH_SECRET=${segredo}\n`,{mode:0o600,flag:'wx'});
 const modelo=fs.readFileSync(path.join(__dirname,'..','supabase-push-agendamento.sql'),'utf8');
 fs.writeFileSync(sqlFile,modelo.replace("segredo text:='COLE_PUSH_DISPATCH_SECRET'",`segredo text:='${segredo}'`),{mode:0o600});
 const quote=s=>"'"+s.replace(/'/g,"''")+"'";
 console.log('Configuração criada fora da pasta do site. Não publique nem compartilhe esses arquivos.');
 console.log('1. Rode supabase-schema-push.sql no SQL Editor.');
 console.log('2. Execute os comandos abaixo na pasta do projeto:');
 console.log('npx supabase login');
 console.log('npx supabase secrets set --env-file '+quote(envFile)+' --project-ref abweepruixcyetrzefhk');
 console.log('npx supabase functions deploy push-notificacoes --project-ref abweepruixcyetrzefhk');
 console.log('3. Abra '+sqlFile+' e execute seu conteúdo no SQL Editor.');
 console.log('4. Publique os arquivos atualizados do site e ative as notificações no menu de cada aparelho.');
}
