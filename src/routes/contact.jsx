import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/contact")({head:()=>({meta:[{title:"Contact — VICEHUB"}]}),component:()=> <LegalPage slug="contact" title="Contact"/>});
