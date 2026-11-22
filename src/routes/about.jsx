import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/about")({head:()=>({meta:[{title:"About VICEHUB — VICEHUB"}]}),component:()=> <LegalPage slug="about" title="About VICEHUB"/>});
