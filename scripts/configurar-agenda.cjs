/* Gera segredos da agenda fora da pasta publicada. Não imprime chaves no terminal. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
function main(){
 const project=fs.realpathSync(path.join(__dirname,'..'));
 let site;
 try{site=new URL(process.argv[2]);}catch{throw Error('Informe a URL HTTPS da pasta que contém index.html. Ex.: node scripts/configurar-agenda.cjs https://seu-dominio.com/');}
 if(site.protocol!=='https:'||site.username||site.password||site.search||site.hash||site.pathname.endsWith('.html'))throw Error('Use o endereço HTTPS da pasta do site, sem usuário, senha, parâmetros ou nome de arquivo.');
 if(!site.pathname.endsWith('/'))site.pathname+='/';
 const folder=path.resolve(process.argv[3]||path.join(process.env.LOCALAPPDATA||os.homedir(),'Imperium','configuracao-agenda'));
 let ancestor=folder;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const resolved=path.join(fs.realpathSync(ancestor),path.relative(ancestor,folder));
 const rel=path.relative(project,resolved);
 if(rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Escolha uma pasta privada fora da pasta do site.');
 const envFile=path.join(folder,'agenda.env'),sqlFile=path.join(folder,'agenda-agendamento.sql');
 if(fs.existsSync(envFile)||fs.existsSync(sqlFile))throw Error('Já existe configuração em '+folder+'. Reutilize os arquivos; trocar AGENDA_DATA_KEY impede ler contatos e conexões existentes.');
 const js=fs.readFileSync(path.join(project,'js','supabase.js'),'utf8'),base=js.match(/https:\/\/[a-z0-9-]+\.supabase\.co\b/i)?.[0];
 if(!base)throw Error('Não foi possível identificar o projeto em js/supabase.js.');
 const ref=new URL(base).hostname.split('.')[0],key=crypto.randomBytes(32).toString('base64'),secret=crypto.randomBytes(32).toString('hex');
 const env=`AGENDA_SITE_URL=${site.href}\nAGENDA_DATA_KEY=${key}\nAGENDA_CRON_SECRET=${secret}\nSMTP_HOST=PREENCHA_MESMO_HOST_ATUAL\nSMTP_PORT=465\nSMTP_USER=PREENCHA_MESMO_USUARIO_ATUAL\nSMTP_PASS=PREENCHA_MESMA_SENHA_ATUAL\nSMTP_FROM=PREENCHA_MESMO_REMETENTE_ATUAL\n`;
 const quote=s=>s.replace(/'/g,"''");
 const model=fs.readFileSync(path.join(project,'supabase-agenda-agendamento.sql'),'utf8');
 const sql=model.replace("destino text := 'COLE_AGENDA_FUNCTION_URL'",`destino text := '${quote(base+'/functions/v1/agenda')}'`).replace("segredo text := 'COLE_AGENDA_CRON_SECRET'",`segredo text := '${quote(secret)}'`);
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 fs.writeFileSync(envFile,env,{flag:'wx',mode:0o600});fs.writeFileSync(sqlFile,sql,{flag:'wx',mode:0o600});
 console.log('Configuração privada criada. Preencha os campos SMTP_* com os mesmos dados usados no sistema.');
 console.log('Segredos: '+envFile);console.log('SQL da fila: '+sqlFile);
 console.log('Depois de preencher o SMTP, execute na pasta do projeto:');
 console.log('npx supabase secrets set --env-file "'+envFile+'" --project-ref '+ref);
 console.log('npx supabase functions deploy agenda --project-ref '+ref);
 console.log('Execute o SQL privado da fila no SQL Editor. Guarde os arquivos fora da hospedagem.');
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
