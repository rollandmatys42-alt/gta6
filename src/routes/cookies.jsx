import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/cookies")({head:()=>({meta:[{title:"Cookie Policy — VICEHUB"}]}),component:()=> <LegalPage slug="cookies" title="Cookie Policy"/>});
