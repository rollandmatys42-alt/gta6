import {useEffect,useState} from "react";
import {createFileRoute} from "@tanstack/react-router";
import SiteFrame from "@/components/SiteFrame";
import {getMyMessages,getCreatorDirectory,sendDirectMessage,markMessageRead,blockCreator} from "@/lib/server-fns";
import {useAuth} from "@/lib/AuthContext";
export const Route=createFileRoute("/messages")({ssr:false,head:()=>({meta:[{title:"Private Messages — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:MessagesPage});
function MessagesPage(){
 const {isAuthenticated,navigateToLogin}=useAuth();const [data,setData]=useState({inbox:[],sent:[]}),[creators,setCreators]=useState([]),[recipient,setRecipient]=useState(""),[body,setBody]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const load=()=>getMyMessages().then(setData).catch(e=>setError(e.message));
 useEffect(()=>{if(isAuthenticated){load();getCreatorDirectory({data:{}}).then(setCreators).catch(()=>{});}},[isAuthenticated]);
 const send=async e=>{e.preventDefault();if(!isAuthenticated){navigateToLogin();return;}try{await sendDirectMessage({data:{recipientId:recipient,body}});setBody("");setNotice("Message sent.");load();}catch(e){setError(e.message);}};
 const name=id=>creators.find(c=>c.user_id===id)?.display_name||"Creator";
 const read=async m=>{if(m.recipient_id===m.sender_id||m.status==="seen")return;try{await markMessageRead({data:{messageId:m.id}});load();}catch{}};
 const block=async id=>{try{await blockCreator({data:{userId:id,reason:"Blocked from private messages."}});setNotice("Creator blocked. New messages between you will be prevented.");}catch(e){setError(e.message);}};
 return <SiteFrame eyebrow="VICEHUB / PRIVATE MESSAGES"><div className="platform-hero"><div><div className="eyebrow">PRIVATE CREATOR CONVERSATIONS</div><h1>YOUR<br/><em>INBOX.</em></h1><p>Contact other creators privately. You can block a sender at any time.</p></div></div>
 {notice&&<div className="platform-success">{notice}</div>}{error&&<div className="platform-alert">{error}</div>}
 <form className="platform-form message-compose" onSubmit={send}><h2>NEW MESSAGE</h2><label>Recipient<select required value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a creator…</option>{creators.map(c=><option value={c.user_id}>{c.display_name}</option>)}</select></label><label>Message<textarea required maxLength={5000} rows={3} value={body} onChange={e=>setBody(e.target.value)}/></label><button className="primary-btn">SEND MESSAGE</button></form>
 <div className="message-columns"><section className="admin-panel"><h2>INBOX ({data.inbox.length})</h2>{data.inbox.map(m=><article className="message-row" key={m.id} onClick={()=>read(m)}><div><b>{name(m.sender_id)}</b><small>{new Date(m.created_date).toLocaleString()}</small></div><p>{m.body}</p><button className="text-btn" onClick={e=>{e.stopPropagation();block(m.sender_id);}}>BLOCK SENDER</button></article>)}{!data.inbox.length&&<div className="platform-empty">Your inbox is empty.</div>}</section><section className="admin-panel"><h2>SENT ({data.sent.length})</h2>{data.sent.map(m=><article className="message-row" key={m.id}><div><b>To: {name(m.recipient_id)}</b><small>{new Date(m.created_date).toLocaleString()}</small></div><p>{m.body}</p><span className="source-pill">{m.status}</span></article>)}{!data.sent.length&&<div className="platform-empty">No sent messages.</div>}</section></div>
 </SiteFrame>;
}
