import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import nodemailer from 'npm:nodemailer@10.1.0';
import {createAgendaService} from './service.ts';
import {smtpSender} from './mail.ts';
const env={SITE_URL:Deno.env.get('AGENDA_SITE_URL')||'',DATA_KEY:Deno.env.get('AGENDA_DATA_KEY')||'',CRON_SECRET:Deno.env.get('AGENDA_CRON_SECRET')||'',RATE_SALT:Deno.env.get('AGENDA_RATE_SALT')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
 SMTP_HOST:Deno.env.get('SMTP_HOST')||'',SMTP_PORT:Deno.env.get('SMTP_PORT')||'465',SMTP_USER:Deno.env.get('SMTP_USER')||'',SMTP_PASS:Deno.env.get('SMTP_PASS')||'',SMTP_FROM:Deno.env.get('SMTP_FROM')||''};
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const service=createAgendaService(db,env,{sendMail:smtpSender(nodemailer,env),defer:promise=>EdgeRuntime.waitUntil(promise)});
Deno.serve(req=>service.fetch(req));
