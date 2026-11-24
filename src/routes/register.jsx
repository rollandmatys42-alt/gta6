import { createFileRoute } from "@tanstack/react-router";
import AuthExperience from "@/components/AuthExperience";
export const Route = createFileRoute("/register")({ head:()=>({meta:[{title:"Create account — VICEHUB"},{name:"robots",content:"noindex,nofollow"}]}),component:()=> <AuthExperience mode="register"/> });
