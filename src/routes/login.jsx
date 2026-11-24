import { createFileRoute } from "@tanstack/react-router";
import AuthExperience from "@/components/AuthExperience";
export const Route = createFileRoute("/login")({ head:()=>({meta:[{title:"Sign in — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:()=> <AuthExperience mode="login"/> });
