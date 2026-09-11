import './style.css'
import { createIcons, FileWarning, Info, Repeat2, Ruler, ScanSearch, ShieldCheck, Sigma, Split, TriangleAlert, Users } from 'lucide'
import { initializeApp } from './ui/app'

initializeApp()
createIcons({ icons: { FileWarning, Info, Repeat2, Ruler, ScanSearch, ShieldCheck, Sigma, Split, TriangleAlert, Users } })