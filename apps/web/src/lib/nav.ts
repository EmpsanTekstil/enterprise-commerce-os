import {
  LayoutDashboard, Package, PackagePlus, Layers, Store, ShoppingCart, Warehouse, Truck, Tags,
  Megaphone, Target, BarChart3, MessageCircleQuestion, Star, Inbox, Sparkles, Landmark, FileBarChart,
  Workflow, Plug, Users, Settings, type LucideIcon,
} from 'lucide-react';

export interface NavItem { href: string; label: string; icon: LucideIcon; ready?: boolean; group: string }

export const NAV: NavItem[] = [
  { href: '/', label: 'Genel Bakış', icon: LayoutDashboard, ready: true, group: 'Ana' },
  { href: '/urunler', label: 'Ürün Yönetimi', icon: Package, ready: true, group: 'Katalog' },
  { href: '/urunler/yeni', label: 'Ürün Oluştur', icon: PackagePlus, ready: true, group: 'Katalog' },
  { href: '/toplu-islemler', label: 'Toplu Ürün İşlemleri', icon: Layers, ready: true, group: 'Katalog' },
  { href: '/yayinlar', label: 'Pazaryeri Yayınları', icon: Store, ready: true, group: 'Katalog' },
  { href: '/siparisler', label: 'Siparişler', icon: ShoppingCart, ready: true, group: 'Operasyon' },
  { href: '/stok', label: 'Stok ve Depolar', icon: Warehouse, ready: true, group: 'Operasyon' },
  { href: '/kargo', label: 'Kargo ve İadeler', icon: Truck, ready: true, group: 'Operasyon' },
  { href: '/fiyat', label: 'Fiyat Yönetimi', icon: Tags, ready: true, group: 'Operasyon' },
  { href: '/reklam', label: 'Reklam Merkezi', icon: Megaphone, ready: true, group: 'Reklam' },
  { href: '/reklam/kampanyalar', label: 'Reklam Kampanyaları', icon: Target, ready: true, group: 'Reklam' },
  { href: '/reklam/analitik', label: 'Reklam Analitiği', icon: BarChart3, ready: true, group: 'Reklam' },
  { href: '/sorular', label: 'Müşteri Soruları', icon: MessageCircleQuestion, ready: true, group: 'Müşteri' },
  { href: '/yorumlar', label: 'Ürün Yorumları', icon: Star, ready: true, group: 'Müşteri' },
  { href: '/gelen-kutusu', label: 'Birleşik Gelen Kutusu', icon: Inbox, ready: true, group: 'Müşteri' },
  { href: '/yapay-zeka', label: 'Yapay Zekâ Stüdyosu', icon: Sparkles, ready: true, group: 'Analiz' },
  { href: '/finans', label: 'Finans', icon: Landmark, ready: true, group: 'Analiz' },
  { href: '/raporlar', label: 'Raporlar', icon: FileBarChart, ready: true, group: 'Analiz' },
  { href: '/otomasyonlar', label: 'Otomasyonlar', icon: Workflow, ready: true, group: 'Sistem' },
  { href: '/entegrasyonlar', label: 'Entegrasyonlar', icon: Plug, ready: true, group: 'Sistem' },
  { href: '/kullanicilar', label: 'Kullanıcılar ve Yetkiler', icon: Users, ready: true, group: 'Sistem' },
  { href: '/ayarlar', label: 'Sistem Ayarları', icon: Settings, ready: true, group: 'Sistem' },
];
