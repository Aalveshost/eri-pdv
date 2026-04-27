import { useState, useEffect, useRef } from "react";
import { 
  Search, ShoppingCart, User, Plus, Minus, X, Check, Trash2, 
  ChevronRight, ArrowLeft, ArrowRight, Save, Banknote, QrCode, 
  CreditCard, Smartphone, Clock, Calculator, Calendar
} from "lucide-react";
import { createPortal } from "react-dom";
import { useDatabase } from "../hooks/useDatabase";
import { formatCurrency } from "../utils/currency";
import { processarVendaFIFO } from "../utils/fifoEngine";
import { invoke } from "@tauri-apps/api/core";

// ─── helpers de data ────────────────────────────────────────────────
function formatDateBR(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function isValidBrDate(br: string): boolean {
  const parts = br.split('/');
  if (parts.length !== 3) return false;
  const d = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const y = parseInt(parts[2]);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// Temporary global to avoid circular dependencies if needed, or just standard state
export let pdvModalOpen = false;
export let pdvNavigateAwayInterceptor: (() => boolean) | null = null;

interface Product {
  id: number;
  nome: string;
  preco_venda: number;
  codigo_barras: string | null;
}

interface CartItem {
  id: number;
  nome: string;
  preco: number;
  quantidade: number;
}

interface Cliente {
  id: number;
  nome: string;
  telefone: string | null;
}

type PDVStage = 'date' | 'selling' | 'checkout';
type CheckoutOption = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'prazo';

export default function PDV() {
  const { db } = useDatabase();
  const [stage, setStage] = useState<PDVStage>('date');
  const [vendaDate, setVendaDate] = useState(formatDateBR(new Date()));
  const [dateDigits, setDateDigits] = useState(new Date().toLocaleDateString('pt-BR').replace(/\D/g, ''));
  
  // Selling state
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [quantityInput, setQuantityInput] = useState("1.000");
  
  // Navigation state
  const [focusedZone, setFocusedZone] = useState<'products' | 'cart'>('products');
  const [focusedProductIndex, setFocusedProductIndex] = useState<number | null>(null);
  const focusedProductIndexRef = useRef<number | null>(null);
  const [focusedCartIndex, setFocusedCartIndex] = useState<number | null>(null);
  const [focusedCartAction, setFocusedCartAction] = useState<'edit' | 'delete' | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  
  // Checkout state
  const [checkoutSelected, setCheckoutSelected] = useState<CheckoutOption>('dinheiro');
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteSearch, setClienteSearch] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<{id: number, nome: string} | null>(null);
  const [clienteFocusedIdx, setClienteFocusedIdx] = useState(-1);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState<'exit' | 'continue'>('continue');

  // Refs
  const productFocusTrapRef = useRef<HTMLButtonElement>(null);
  const cartFocusTrapRef = useRef<HTMLButtonElement>(null);
  const modalQuantityRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const editingItemIdRef = useRef<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const editingItemPrecoRef = useRef<number>(0);
  const [editingTotalInput, setEditingTotalInput] = useState("");
  const clienteListRef = useRef<HTMLDivElement>(null);
  const clienteItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [vendaSuccess, setVendaSuccess] = useState<string|null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Sync ref for key handlers
  useEffect(() => { editingItemIdRef.current = editingItemId; }, [editingItemId]);

  // Total
  const total = cart.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

  // Load products on search
  useEffect(() => {
    if (!db) return;
    const searchProducts = async () => {
      if (search.trim().length === 0) {
        setProducts([]);
        return;
      }
      const isBarcode = /^\d{8,14}$/.test(search);
      let query = "SELECT id, nome, preco_venda, codigo_barras FROM produtos WHERE ativo = 1 ";
      let params: any[] = [];
      
      if (isBarcode) {
        query += "AND codigo_barras = $1";
        params = [search];
      } else {
        query += "AND nome LIKE $1 ORDER BY nome LIMIT 10";
        params = [`%${search}%`];
      }
      
      const rows: any[] = await db.select(query, params);
      setProducts(rows);
      
      if (isBarcode && rows.length === 1) {
        handleProductSelect(rows[0]);
        setSearch('');
      }
    };
    const timer = setTimeout(searchProducts, 150);
    return () => clearTimeout(timer);
  }, [search, db]);

  // Initial products
  useEffect(() => {
    if (!db) return;
    const loadInitial = async () => {
      const rows: any[] = await db.select(
        "SELECT id, nome, preco_venda, codigo_barras FROM produtos WHERE ativo = 1 ORDER BY nome LIMIT 20"
      );
      setProducts(rows);
    };
    loadInitial();
  }, [db]);

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
    setQuantityInput("1.000");
    setShowQuantityModal(true);
  };

  const addToCart = () => {
    if (!selectedProduct) return;
    const qty = parseFloat(quantityInput);
    if (qty <= 0) return;

    if (editingItemId !== null) {
      setCart(prev => prev.map(item => 
        item.id === editingItemId 
          ? { ...item, quantidade: qty, preco: editingItemPrecoRef.current } 
          : item
      ));
      setEditingItemId(null);
    } else {
      setCart(prev => {
        const existing = prev.find(item => item.id === selectedProduct.id);
        if (existing) {
          return prev.map(item => 
            item.id === selectedProduct.id 
              ? { ...item, quantidade: item.quantidade + qty } 
              : item
          );
        }
        return [...prev, {
          id: selectedProduct.id,
          nome: selectedProduct.nome,
          preco: selectedProduct.preco_venda,
          quantidade: qty
        }];
      });
    }
    
    setShowQuantityModal(false);
    setQuantityInput("1.000");
    setSelectedProduct(null);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  // Keyboard navigation for date stage
  useEffect(() => {
    if (stage !== 'date') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (isValidBrDate(vendaDate)) {
          setStage('products' as any); // Transition to selling
          setStage('selling');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stage, vendaDate]);

  // Keyboard for Cliente Modal
  useEffect(() => {
    if (!showClienteModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setClienteFocusedIdx(prev => Math.min(prev + 1, clientes.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setClienteFocusedIdx(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (clienteSelecionado) handleFinalize('prazo', clienteSelecionado.id);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        setShowClienteModal(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showClienteModal, clienteSearch, clienteSelecionado, clientes]);

  // Checkout keyboard navigation + sidebar lock
  useEffect(() => {
    if (stage !== 'checkout') return;
    setCheckoutSelected('dinheiro');

    // nav map: key -> {up,down,left,right}
    const nav: Record<string, Partial<Record<string, string>>> = {
      dinheiro: { right: 'pix',      down: 'credito' },
      pix:      { left:  'dinheiro',  down: 'debito'  },
      credito:  { up: 'dinheiro',    right: 'debito', down: 'prazo' },
      debito:   { up: 'pix',         left:  'credito', down: 'prazo' },
      prazo:    { up: 'credito' },
    };

    const confirmSelected = (sel: string) => {
      if (sel === 'prazo') handleAPrazo();
      else handleFinalize(sel);
    };

    const handler = (e: KeyboardEvent) => {
      if (showClienteModal) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Tab'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
      }
      if (e.key === 'Escape') { setStage('selling'); return; }
      if (e.key === 'Enter') {
        setCheckoutSelected(prev => { confirmSelected(prev); return prev; });
        return;
      }
      const moves: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Tab: 'down' };
      const dir = moves[e.key];
      if (!dir) return;
      setCheckoutSelected(prev => {
        const next = nav[prev]?.[dir];
        return (next as CheckoutOption) ?? prev;
      });
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [stage, showClienteModal]);

  // Keep pdvModalOpen in sync so Layout can skip its key handling while a modal is open
  useEffect(() => {
    pdvModalOpen = showExitConfirm || showQuantityModal || showClienteModal || stage === 'checkout';
    return () => { pdvModalOpen = false; };
  }, [showExitConfirm, showQuantityModal, showClienteModal, stage]);

  // Register navigate-away interceptor so Layout can ask PDV before leaving
  useEffect(() => {
    pdvNavigateAwayInterceptor = () => {
      if (cart.length > 0) {
        setExitConfirmSelected('exit');
        setShowExitConfirm(true);
        return true; // blocked
      }
      return false; // free to navigate
    };
    return () => { pdvNavigateAwayInterceptor = null; };
  }, [cart.length]);

  useEffect(() => {
    if (!showExitConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setExitConfirmSelected(prev => prev === 'exit' ? 'continue' : 'exit');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (exitConfirmSelected === 'exit') {
          setCart([]);
          setShowExitConfirm(false);
          setStage('date');
          setTimeout(() => {
            const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
            activeSidebarLink?.focus();
          }, 0);
        } else {
          setShowExitConfirm(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowExitConfirm(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showExitConfirm, exitConfirmSelected]);

  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const isAllSelected = (input.selectionStart === 0 && input.selectionEnd === input.value.length);

    if (e.key === 'Escape') {
      e.preventDefault();
      setShowQuantityModal(false);
      setQuantityInput("1.000");
      setSelectedProduct(null);
      setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (document.activeElement === modalQuantityRef.current) {
        addBtnRef.current?.focus();
      } else {
        modalQuantityRef.current?.focus();
      }
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (isAllSelected) {
        setQuantityInput("0.000");
        return;
      }
      const digits = quantityInput.replace(/\D/g, "");
      const newDigits = digits.substring(0, digits.length - 1).padStart(4, '0');
      const formatted = (parseInt(newDigits) / 1000).toFixed(3);
      setQuantityInput(formatted);
      return;
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      let digits = quantityInput.replace(/\D/g, "");
      
      if (isAllSelected) {
        digits = e.key.padStart(4, '0');
      } else {
        digits = (digits + e.key).replace(/^0+/, '').padStart(4, '0');
      }

      if (digits.length > 8) return; // Limit to 99999.999

      const formatted = (parseInt(digits) / 1000).toFixed(3);
      setQuantityInput(formatted);
    }
    
    // Ignore other keys like dots or commas in calculator mode
    if (e.key === '.' || e.key === ',') {
      e.preventDefault();
    }
  };

  // Keyboard navigation (selling stage only)
  useEffect(() => {
    if (stage !== 'selling') return;

    const enterProductZone = () => {
      setFocusedZone('products');
      setTimeout(() => productFocusTrapRef.current?.focus(), 0);
    };
    const enterCartZone = () => {
      setFocusedZone('cart');
      setFocusedCartIndex(prev => prev ?? 0);
      setFocusedCartAction(null);
      setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showQuantityModal || showExitConfirm || showClienteModal || editingItemIdRef.current !== null) {
        return;
      }

      // F1: finalizar venda
      if (e.key === 'F1') {
        e.preventDefault(); e.stopPropagation();
        if (cart.length > 0) setStage('checkout');
        return;
      }

      // Tab: toggle zone (prevent default browser tab)
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (focusedZone === 'cart') enterProductZone();
        else if (cart.length > 0) enterCartZone();
        return;
      }

      // ESC: global exit or clear
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (showExitConfirm) { setShowExitConfirm(false); return; }
        if (focusedZone === 'cart') {
          enterProductZone(); return;
        }
        if (focusedProductIndexRef.current !== null) {
          focusedProductIndexRef.current = null;
          setFocusedProductIndex(null);
          return;
        }
        if (search.length > 0) { setSearch(''); setProducts([]); return; }
        if (cart.length > 0) { setExitConfirmSelected('exit'); setShowExitConfirm(true); }
        else { setStage('date'); }
        return;
      }

      // ── CART ZONE ──────────────────────────────────────────────────
      if (focusedZone === 'cart') {
        e.stopPropagation();

        // Confirm delete sub-mode
        if (confirmDeleteIdx !== null) {
          e.preventDefault();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { /* visual only */ }
          else if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
            setCart(prev => prev.filter((_, i) => i !== confirmDeleteIdx));
            setConfirmDeleteIdx(null); setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
            enterProductZone();
          } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
            setConfirmDeleteIdx(null); setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
          }
          return;
        }

        // Action buttons sub-mode (Editar / Remover)
        if (focusedCartIndex !== null && focusedCartAction !== null) {
          e.preventDefault();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            setFocusedCartAction(prev => prev === 'edit' ? 'delete' : 'edit');
          } else if (e.key === 'Enter') {
            if (focusedCartAction === 'edit') {
              const item = cart[focusedCartIndex];
              editingItemPrecoRef.current = Number(item.preco);
              setEditingItemId(item.id);
              setQuantityInput(item.quantidade.toFixed(3));
              setEditingTotalInput(formatCurrency(Number(item.preco) * Number(item.quantidade)));
              setFocusedCartAction(null);
            } else {
              setConfirmDeleteIdx(focusedCartIndex);
            }
          } else if (e.key === 'Escape') {
            setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
          }
          return;
        }

        // Cart item list navigation
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedCartIndex(prev => prev !== null ? Math.min(prev + 1, cart.length - 1) : 0);
          setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedCartIndex(prev => prev !== null && prev > 0 ? prev - 1 : 0);
          setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setFocusedCartAction('edit');
        } else if (e.key === 'ArrowLeft' || e.key === 'Tab') {
          e.preventDefault();
          enterProductZone();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); // no-op, already rightmost
        }
        return;
      }

      // ── PRODUCT ZONE (or no zone yet) ─────────────────────────────
      // ArrowRight / ArrowLeft / Tab: handle zone transitions or text nav
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // If typing in search, let arrows work normally for text navigation
        if (document.activeElement === searchInputRef.current) return;

        if (e.key === 'ArrowRight' && cart.length > 0) {
          e.preventDefault(); e.stopPropagation(); enterCartZone();
        }
        return;
      }

      // ArrowDown/Up: navigate product results (auto-enter product zone)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        if (focusedZone !== 'products') setFocusedZone('products');
        const curIdx = focusedProductIndexRef.current;
        if (e.key === 'ArrowDown') {
          if (products.length > 0) {
            const next = curIdx === null ? 0 : Math.min(curIdx + 1, products.length - 1);
            focusedProductIndexRef.current = next;
            setFocusedProductIndex(next);
          }
        } else {
          if (curIdx === null || curIdx === 0) {
            focusedProductIndexRef.current = null;
            setFocusedProductIndex(null);
          } else {
            const prev = curIdx - 1;
            focusedProductIndexRef.current = prev;
            setFocusedProductIndex(prev);
          }
        }
        return;
      }

      // Enter: add focused product to cart
      if (e.key === 'Enter' && focusedProductIndexRef.current !== null && products[focusedProductIndexRef.current]) {
        e.preventDefault(); e.stopPropagation();
        handleProductSelect(products[focusedProductIndexRef.current]);
        focusedProductIndexRef.current = null;
        setFocusedProductIndex(null);
        return;
      }

      // Printable key while focus trap is active → forward to search input
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement === productFocusTrapRef.current) {
        searchInputRef.current?.focus();
        // Let the event propagate so the character lands in the input
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [stage, cart, cart.length, showExitConfirm, products, focusedProductIndex, search, focusedCartIndex, focusedCartAction, confirmDeleteIdx, focusedZone, editingItemId, showQuantityModal, showClienteModal]);

  const loadClientes = async () => {
    if (!db) return;
    const rows: any[] = await db.select("SELECT id, nome, telefone FROM clientes ORDER BY nome");
    setClientes(rows);
  };

  const handleFinalize = async (metodo: string, clienteId?: number) => {
    if (!db || cart.length === 0) return;

    try {
      const itemsInput = cart.map(i => ({
        produtoId: i.id,
        quantidade: i.quantidade,
        precoUnitario: i.preco
      }));
      const isoDate = vendaDate.split('/').reverse().join('-');

      if (metodo === 'prazo' && clienteId) {
        // Registra no FIFO normalmente (priorizando data da venda)
        await processarVendaFIFO(db, itemsInput, 'prazo', total, isoDate);
        // Também registra em vendas_prazo
        const res = await db.execute(
          "INSERT INTO vendas_prazo (cliente_id, data_venda, total) VALUES ($1, $2, $3)",
          [clienteId, isoDate, total]
        );
        const vendaIdPrazo = res.lastInsertId;
        for (const item of cart) {
          await db.execute(
            "INSERT INTO vendas_prazo_itens (venda_id, produto_nome, quantidade, valor_total) VALUES ($1, $2, $3, $4)",
            [vendaIdPrazo, item.nome, item.quantidade, item.preco * item.quantidade]
          );
        }
      } else {
        await processarVendaFIFO(db, itemsInput, metodo, total, isoDate);
      }

      setCart([]);
      setClienteSelecionado(null);
      setShowClienteModal(false);
      setVendaSuccess(metodo === 'prazo' ? `Venda lançada no prazo para ${clienteSelecionado?.nome}!` : 'Venda realizada com sucesso!');
      setStage('date');
      const now = new Date();
      setDateDigits(
        String(now.getDate()).padStart(2,'0') +
        String(now.getMonth()+1).padStart(2,'0') +
        String(now.getFullYear())
      );
      
      // Auto-hide success message after 3 seconds
      setTimeout(() => setVendaSuccess(null), 3000);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Erro ao processar venda:", msg);
      alert("Erro ao processar venda: " + msg);
    }
  };

  const handleAPrazo = async () => {
    await loadClientes();
    setClienteSearch('');
    setClienteSelecionado(null);
    setShowClienteModal(true);
  };

  const handleDateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const pos = input.selectionStart ?? 0;

    if (e.key === 'Enter') {
      if (isValidBrDate(vendaDate)) {
        setStage('selling');
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      if (isValidBrDate(vendaDate)) {
        setStage('selling');
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      return;
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      if (pos >= 10) return;
      const nd = dateDigits.slice(0, pos) + e.key + dateDigits.slice(pos + 1);
      setDateDigits(nd);
      const br = nd.slice(0,2)+'/'+nd.slice(2,4)+'/'+nd.slice(4,8);
      setVendaDate(br);
      const np = pos + 1;
      const dispPos = np <= 2 ? np : np <= 4 ? np+1 : np+2;
      setTimeout(() => input.setSelectionRange(dispPos, dispPos), 0);
    }
    
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (pos === 0) return;
      const rawPos = pos <= 2 ? pos : pos <= 5 ? pos-1 : pos-2;
      const nd = dateDigits.slice(0, rawPos - 1) + '_' + dateDigits.slice(rawPos);
      setDateDigits(nd);
      const br = nd.slice(0,2)+'/'+nd.slice(2,4)+'/'+nd.slice(4,8);
      setVendaDate(br);
      const pr = rawPos - 1;
      const dispPos = pr <= 2 ? pr : pr <= 4 ? pr+1 : pr+2;
      setTimeout(() => input.setSelectionRange(dispPos, dispPos), 0);
    }
  };

  if (stage === 'date') {
    return (
      <div className="flex flex-col h-full justify-center items-center">
        <h2 className="text-5xl font-black italic text-luxury-orange uppercase mb-2">Data da Venda</h2>
        <p className="text-white/20 uppercase tracking-widest text-xs font-bold mb-10">(DD/MM/YYYY)</p>
        
        <div className="relative group">
          <input
            ref={dateInputRef}
            autoFocus
            type="text"
            className="bg-transparent border-b-4 border-white/10 text-6xl font-mono text-white text-center py-4 outline-none focus:border-luxury-orange transition-all w-[400px] tracking-widest"
            value={vendaDate}
            onKeyDown={handleDateKeyDown}
            onChange={() => {}}
          />
          <div className="absolute -bottom-10 left-0 w-full text-center opacity-0 group-focus-within:opacity-100 transition-opacity">
            <p className="text-white/40 text-xs font-bold uppercase tracking-widest">Pressione ENTER para continuar</p>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'selling') {
    return (
      <div className="flex h-full gap-4 overflow-hidden">
        {/* Left: Search & Results */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          <div className="flex gap-4">
            <div className="glass-card flex-1 flex items-center px-4 py-3 gap-3">
              <Search className="text-luxury-orange" size={24} />
              <input
                ref={searchInputRef}
                autoFocus
                type="text"
                placeholder="Pesquisar produto ou código de barras..."
                className="bg-transparent flex-1 text-xl outline-none font-bold placeholder:text-white/20 uppercase"
                value={search}
                onChange={e => setSearch(e.target.value.toUpperCase())}
              />
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/5 border border-white/10">
                <span className="text-[10px] font-black text-white/40 uppercase">F1</span>
                <span className="text-[10px] font-black text-white/40 uppercase">Pagar</span>
              </div>
            </div>

            <div className="glass-card px-5 py-3 flex flex-col items-center justify-center min-w-[120px]">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Itens</p>
              <p className="text-2xl font-black">{cart.length}</p>
            </div>
          </div>

          <div className="flex-1 glass-card overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/5">
              <h2 className="text-xs font-black uppercase tracking-widest text-white/40">Resultados da Busca</h2>
              <span className="text-[10px] font-bold text-white/20 uppercase">Setas para navegar</span>
            </div>
            
            <button ref={productFocusTrapRef} className="sr-only" tabIndex={-1} />
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {products.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-20 p-10 text-center">
                  <Calculator size={64} className="mb-4" />
                  <p className="uppercase font-black italic text-xl tracking-tighter">Pronto para a próxima venda</p>
                  <p className="text-sm font-bold mt-2">Digite o nome ou use o leitor de barras</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-2">
                  {products.map((p, idx) => {
                    const isFocused = focusedZone === 'products' && focusedProductIndex === idx;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleProductSelect(p)}
                        className={`flex flex-col p-4 rounded-2xl text-left transition-all outline-none border ${
                          isFocused 
                            ? 'bg-luxury-orange border-luxury-orange shadow-lg shadow-luxury-orange/20 scale-[1.02] z-10' 
                            : 'bg-white/5 border-white/5 hover:bg-white/10'
                        }`}
                      >
                        <p className={`font-black uppercase text-sm mb-1 leading-tight ${isFocused ? 'text-white' : 'text-white/90'}`}>{p.nome}</p>
                        <div className="flex justify-between items-end">
                          <p className={`text-lg font-black ${isFocused ? 'text-white' : 'text-luxury-orange'}`}>
                            R$ {p.preco_venda.toFixed(2)}
                          </p>
                          {p.codigo_barras && (
                            <p className={`text-[10px] font-mono ${isFocused ? 'text-white/60' : 'text-white/20'}`}>
                              {p.codigo_barras}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Cart */}
        <div className="w-[450px] flex flex-col gap-4 overflow-hidden">
          <div className="glass-card flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
              <div className="flex items-center gap-2">
                <ShoppingCart className="text-luxury-orange" size={18} />
                <h2 className="text-xs font-black uppercase tracking-widest text-white/40">Carrinho</h2>
              </div>
              <p className="text-lg font-black text-white">{cart.length} itens</p>
            </div>

            <button ref={cartFocusTrapRef} className="sr-only" tabIndex={-1} />
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-10 p-10 text-center">
                  <ShoppingCart size={48} className="mb-4" />
                  <p className="uppercase font-black text-sm">Carrinho Vazio</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {cart.map((item, idx) => {
                    const isFocused = focusedZone === 'cart' && focusedCartIndex === idx;
                    const isDeleting = confirmDeleteIdx === idx;
                    return (
                      <div key={item.id} className="relative">
                        <div 
                          className={`flex flex-col px-6 py-4 border-b border-white/5 transition-all outline-none ${
                            isFocused ? 'bg-white/10' : ''
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <p className="font-black uppercase text-sm text-white/90 leading-tight flex-1">{item.nome}</p>
                            <p className="font-mono text-xs text-white/30 ml-4">{item.quantidade.toFixed(3)}x</p>
                          </div>
                          <div className="flex justify-between items-center">
                            <p className="text-sm font-bold text-white/40 italic">R$ {item.preco.toFixed(2)}/un</p>
                            <p className="text-lg font-black text-luxury-orange">R$ {(item.preco * item.quantidade).toFixed(2)}</p>
                          </div>

                          {/* Quick Actions overlay when focused */}
                          {isFocused && !isDeleting && (
                            <div className="absolute inset-0 bg-luxury-dark-gray/90 backdrop-blur-sm flex items-center justify-center gap-2 px-4">
                              <button 
                                onClick={() => {
                                  editingItemPrecoRef.current = Number(item.preco);
                                  setEditingItemId(item.id);
                                  setQuantityInput(item.quantidade.toFixed(3));
                                  setEditingTotalInput(formatCurrency(Number(item.preco) * Number(item.quantidade)));
                                  setFocusedCartAction(null);
                                }}
                                className={`flex-1 h-10 rounded-xl flex items-center justify-center gap-2 font-black uppercase text-[10px] transition-all ${
                                  focusedCartAction === 'edit' ? 'bg-luxury-orange text-white' : 'bg-white/10 text-white/40'
                                }`}
                              >
                                <Calculator size={14} /> Editar
                              </button>
                              <button 
                                onClick={() => setConfirmDeleteIdx(idx)}
                                className={`flex-1 h-10 rounded-xl flex items-center justify-center gap-2 font-black uppercase text-[10px] transition-all ${
                                  focusedCartAction === 'delete' ? 'bg-red-600 text-white' : 'bg-white/10 text-white/40'
                                }`}
                              >
                                <Trash2 size={14} /> Remover
                              </button>
                            </div>
                          )}

                          {/* Confirm Delete overlay */}
                          {isDeleting && (
                            <div className="absolute inset-0 bg-red-600 flex items-center justify-center gap-4 px-4 animate-in fade-in zoom-in duration-200">
                              <p className="font-black uppercase text-white text-xs italic">Remover item?</p>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => {
                                    setCart(prev => prev.filter((_, i) => i !== idx));
                                    setConfirmDeleteIdx(null);
                                    setTimeout(() => productFocusTrapRef.current?.focus(), 0);
                                  }}
                                  className="h-8 px-4 bg-white text-red-600 rounded-lg font-black uppercase text-[10px]"
                                >
                                  SIM [ENTER]
                                </button>
                                <button 
                                  onClick={() => setConfirmDeleteIdx(null)}
                                  className="h-8 px-4 bg-black/20 text-white rounded-lg font-black uppercase text-[10px]"
                                >
                                  NÃO [ESC]
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-6 bg-white/5 border-t border-white/10">
              <div className="flex justify-between items-end mb-4">
                <p className="text-xs font-black uppercase tracking-widest text-white/30">Total a Pagar</p>
                <p className="text-4xl font-black text-luxury-orange leading-none">R$ {total.toFixed(2)}</p>
              </div>
              <button 
                disabled={cart.length === 0}
                onClick={() => setStage('checkout')}
                className="w-full h-14 bg-luxury-orange hover:bg-luxury-orange-light disabled:opacity-20 disabled:cursor-not-allowed text-black font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all rounded-2xl shadow-[0_0_30px_rgba(255,102,0,0.2)] active:scale-[0.98]"
              >
                <Banknote size={24} />
                Finalizar Venda [F1]
              </button>
            </div>
          </div>
        </div>

        {/* MODAL QUANTIDADE / EDIÇÃO */}
        {showQuantityModal && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <div className="glass-card w-full max-w-md p-8 border-luxury-orange/40 relative overflow-hidden">
              {/* Header decorativo */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-luxury-orange to-transparent opacity-50"></div>
              
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-2xl font-black italic text-luxury-orange uppercase leading-tight mb-1">
                    {editingItemId !== null ? 'Alterar Quantidade' : 'Quantidade'}
                  </h3>
                  <p className="text-white/60 font-bold uppercase tracking-tighter text-sm">
                    {selectedProduct?.nome || cart.find(i => i.id === editingItemId)?.nome}
                  </p>
                </div>
                <div className="p-3 bg-luxury-orange/10 rounded-xl text-luxury-orange">
                  <Calculator size={24} />
                </div>
              </div>

              <div className="bg-white/5 rounded-2xl p-6 mb-6 border border-white/10">
                <p className="text-xs font-black text-white/30 uppercase tracking-widest mb-2 text-center">Quantidade</p>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      const val = Math.max(0, parseFloat(quantityInput) - 1);
                      setQuantityInput(val.toFixed(3));
                    }}
                    className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 text-white/40 hover:bg-white/10 hover:text-white transition-all"
                  >
                    <Minus size={20} />
                  </button>
                  
                  <input
                    ref={modalQuantityRef}
                    autoFocus
                    type="text"
                    className="bg-transparent text-5xl font-mono font-black text-white text-center flex-1 outline-none"
                    value={quantityInput}
                    onKeyDown={handleQuantityKeyDown}
                    onChange={() => {}}
                    onFocus={e => e.target.select()}
                  />

                  <button 
                    onClick={() => {
                      const val = parseFloat(quantityInput) + 1;
                      setQuantityInput(val.toFixed(3));
                    }}
                    className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 text-white/40 hover:bg-white/10 hover:text-white transition-all"
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  ref={addBtnRef}
                  onClick={addToCart}
                  className="btn-primary w-full h-14 uppercase font-black tracking-widest text-sm shadow-xl shadow-luxury-orange/20"
                >
                  Adicionar (ENTER)
                </button>
                <button
                  onClick={() => {
                    setShowQuantityModal(false);
                    setQuantityInput("1.000");
                    setSelectedProduct(null);
                  }}
                  className="w-full h-10 border border-white/10 rounded-lg hover:bg-white/5 uppercase text-[10px] font-bold text-white/40"
                >
                  Cancelar (ESC)
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Exit Confirmation */}
        {showExitConfirm && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowExitConfirm(false); }}>
            <div className="glass-card w-full max-w-sm p-8">
              <h3 className="text-xl font-black mb-4 text-white">Sair sem salvar?</h3>
              <p className="text-white/40 text-sm mb-6">Existem {cart.length} item(s) no carrinho que serão perdidos.</p>

              <div className="space-y-2">
                <button
                  onClick={() => {
                    setCart([]);
                    setShowExitConfirm(false);
                    setStage('date');
                    setTimeout(() => {
                      const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
                      activeSidebarLink?.focus();
                    }, 0);
                  }}
                  className={`btn-primary w-full h-10 uppercase text-sm transition-all ${exitConfirmSelected === 'exit' ? 'bg-red-600 ring-2 ring-white/50' : 'bg-red-600/50 hover:bg-red-600'}`}
                >
                  Sair e Limpar
                </button>
                <button
                  onClick={() => {
                    setShowExitConfirm(false);
                    setTimeout(() => searchInputRef.current?.focus(), 0);
                  }}
                  className={`w-full h-10 border rounded-lg uppercase text-xs font-bold transition-all ${exitConfirmSelected === 'continue' ? 'border-white/50 bg-white/10 ring-2 ring-white/30' : 'border-white/10 hover:bg-white/5'}`}
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  // Stage: Checkout
  const coSel = (id: CheckoutOption) => checkoutSelected === id;
  const coBtn = (id: CheckoutOption, extra?: string) =>
    `flex items-center gap-4 p-4 rounded-xl border transition-all text-left outline-none ${
      coSel(id)
        ? 'bg-luxury-orange border-luxury-orange shadow-lg shadow-luxury-orange/20'
        : `bg-white/5 border-white/5 hover:bg-white/10 ${extra ?? ''}`
    }`;

  if (stage === 'checkout') {
    return (
      <>
      <div className="flex flex-col h-full justify-center items-center p-4">
        <div className="w-full max-w-xl flex flex-col gap-4">

          {/* Header: itens + data + total */}
          <div className="flex gap-3">
            <div className="glass-card px-5 py-4 flex flex-col items-center justify-center min-w-[80px]">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Itens</p>
              <p className="text-2xl font-black">{cart.length}</p>
            </div>
            <div className="glass-card flex-1 px-5 py-4">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Data</p>
              <p className="text-lg font-black">{vendaDate}</p>
            </div>
            <div className="glass-card flex-[2] px-5 py-4 border border-luxury-orange/30 bg-luxury-orange/5">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Total a Pagar</p>
              <p className="text-3xl font-black text-luxury-orange">R$ {total.toFixed(2)}</p>
            </div>
          </div>

          {vendaSuccess && (
            <div className="px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-sm">
              {vendaSuccess}
            </div>
          )}

          {/* Payment methods */}
          <div>
            <p className="text-[10px] uppercase text-white/40 font-bold mb-3 px-1">Forma de Pagamento</p>

            {/* 2×2 grid: Dinheiro, PIX, Crédito, Débito */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              {([
                { id: 'dinheiro' as CheckoutOption, label: 'Dinheiro', sub: 'À vista em espécie',       icon: Banknote   },
                { id: 'pix'      as CheckoutOption, label: 'PIX',      sub: 'Transferência instantânea', icon: QrCode     },
                { id: 'credito'  as CheckoutOption, label: 'Crédito',  sub: 'Cartão de crédito',        icon: CreditCard },
                { id: 'debito'   as CheckoutOption, label: 'Débito',   sub: 'Cartão de débito',         icon: Smartphone },
              ] as const).map(m => (
                <button key={m.id} onClick={() => handleFinalize(m.id)} className={coBtn(m.id)}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${coSel(m.id) ? 'bg-white/20' : 'bg-luxury-orange/10'}`}>
                    <m.icon size={20} className={coSel(m.id) ? 'text-white' : 'text-luxury-orange'} />
                  </div>
                  <div>
                    <p className={`font-black uppercase text-sm ${coSel(m.id) ? 'text-white' : ''}`}>{m.label}</p>
                    <p className={`text-[10px] ${coSel(m.id) ? 'text-white/70' : 'text-white/40'}`}>{m.sub}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* A Prazo — final, linha cheia */}
            <button onClick={handleAPrazo} className={`w-full mb-3 ${coBtn('prazo')}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${coSel('prazo') ? 'bg-white/20' : 'bg-luxury-orange/10'}`}>
                <Clock size={20} className={coSel('prazo') ? 'text-white' : 'text-luxury-orange'} />
              </div>
              <div>
                <p className={`font-black uppercase text-sm ${coSel('prazo') ? 'text-white' : 'text-luxury-orange'}`}>A Prazo</p>
                <p className={`text-[10px] ${coSel('prazo') ? 'text-white/70' : 'text-white/40'}`}>Registrar como fiado — selecionar cliente</p>
              </div>
            </button>
          </div>

          <button
            onClick={() => setStage('selling')}
            className="w-full h-9 border border-white/10 hover:bg-white/5 rounded-lg uppercase text-xs font-bold text-white/40 hover:text-white transition-all"
          >
            Voltar (ESC)
          </button>
        </div>
      </div>

      {/* Modal seleção de cliente para A Prazo */}
      {showClienteModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowClienteModal(false); }}>
          <div className="glass-card w-full max-w-xl p-8">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-xl font-black italic text-luxury-orange uppercase">Selecionar Cliente</h3>
              <button onClick={() => setShowClienteModal(false)} className="text-white/40 hover:text-white"><X size={20} /></button>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="Buscar cliente..."
              className="luxury-input w-full h-11 mb-3"
              value={clienteSearch}
              onChange={e => { setClienteSearch(e.target.value.toUpperCase()); setClienteFocusedIdx(-1); setClienteSelecionado(null); }}
            />
            <div ref={clienteListRef} className="max-h-80 overflow-auto space-y-1 mb-4 pr-1">
              {(() => {
                const filtered = clientes.filter(c =>
                  c.nome.includes(clienteSearch) || (c.telefone || '').includes(clienteSearch)
                );
                clienteItemRefs.current = [];
                if (filtered.length === 0) return (
                  <p className="text-center text-white/30 text-sm py-6">Nenhum cliente encontrado</p>
                );
                return filtered.map((c, idx) => {
                  const isSelected = clienteSelecionado?.id === c.id;
                  const isFocused = clienteFocusedIdx === idx;
                  return (
                    <button
                      key={c.id}
                      ref={el => { clienteItemRefs.current[idx] = el; }}
                      onClick={() => { setClienteSelecionado({ id: c.id, nome: c.nome }); setClienteFocusedIdx(idx); }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all font-semibold flex items-center gap-3 outline-none ${
                        isSelected
                          ? 'bg-luxury-orange text-white ring-2 ring-luxury-orange/50'
                          : isFocused
                          ? 'bg-luxury-orange/20 text-white ring-1 ring-luxury-orange/30'
                          : 'bg-white/5 hover:bg-white/10 text-white/80'
                      }`}
                    >
                      <span className={`text-xs font-mono shrink-0 ${isSelected ? 'text-white/70' : 'text-white/30'}`}>#{c.id}</span>
                      <span className="flex-1">{c.nome}</span>
                      {isSelected && <span className="text-xs text-white/60 font-normal">↵ confirmar</span>}
                    </button>
                  );
                });
              })()}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowClienteModal(false)} className="flex-1 h-12 border border-white/10 rounded-xl hover:bg-white/5 uppercase text-xs font-bold text-white/40 hover:text-white transition-all">Cancelar</button>
              <button
                disabled={!clienteSelecionado}
                onClick={() => clienteSelecionado && handleFinalize('prazo', clienteSelecionado.id)}
                className="btn-primary flex-1 h-12 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      </>
    );
  }
}
