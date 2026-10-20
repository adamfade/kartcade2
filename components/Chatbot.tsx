import { GoogleGenerativeAI } from '@google/generative-ai';
import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles, Loader2, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// Initialize Gemini (Client Side for Demo)
// Note: In production, moving this back to an API route is safer for key protection.
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" }); // Using 3.0 Flash Preview

const getCurrentDate = () => {
    return new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

const SYSTEM_PROMPT = `
You are the AI Assistant for Kartcade, a premium racing simulator lounge in West Linn, Oregon.
Your goal is to be helpful, friendly, and drive bookings.

**CURRENT DATE/TIME:** ${getCurrentDate()}
(Use this to calculate dates like "tomorrow" or "next Friday").

**FORMATTING RULES:**
- Use **Bullet Points** for lists.
- Use **Bold** for emphasis.
- Keep paragraphs short (maximum 2 sentences).
- Add newlines between sections to avoid clutter.

**CRITICAL INSTRUCTION:**
Most users are new. If they ask "What do you have?", explain cleanly:

**OUR SIMULATORS:**

*   🏎️ **Racing Karts ($30/hr):** Casual fun for kids (5+) & beginners.
*   🖥️ **Full-Size Rigs ($40/hr):** Pro direct-drive wheels for adults (10+).
*   🚀 **Motion Sim ($50/hr):** The Ultimate Experience. Moves with the game! (14+).
*   ✈️ **Flight Sim ($40/hr):** Joystick setup for flying.

**BOOKING INSTRUCTIONS:**
- **MANDATORY:** You MUST ask for **Date AND Time** before creating a link.
- IF user says "tomorrow" but no time -> Ask "What time would you like? (10am - 10pm)".
- DO NOT hallucinate a time.

- GENERATE LINK ONLY when you have Date + Time + Station:
  [Click here to Book](/book?date=YYYY-MM-DD&time=HH:00&station=ID)
- Station IDs: 'karts', 'rigs', 'motion', 'flight'.

**TONE:**
Friendly, energetic, and concise. Use emojis.
`;

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

const Chatbot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: 'Hi! I can help you book a race or answer questions. Try asking: "Book a Kart for tomorrow at 2pm"' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsLoading(true);

        try {
            // Start Chat Session
            const chat = model.startChat({
                history: [
                    {
                        role: "user",
                        parts: [{ text: SYSTEM_PROMPT }],
                    },
                    {
                        role: "model",
                        parts: [{ text: "Understood. I'm ready to help users book at Kartcade." }],
                    },
                    ...messages.map(m => ({
                        role: m.role === 'user' ? 'user' : 'model',
                        parts: [{ text: m.content }]
                    }))
                ],
            });

            const result = await chat.sendMessage(userMsg);
            const response = result.response.text();

            setMessages(prev => [...prev, { role: 'assistant', content: response }]);

        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSend();
    };

    return (
        <>
            {/* Toggle Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-[9999] bg-[#2D9E49] hover:bg-[#248a3f] text-white p-3 sm:p-4 rounded-full shadow-lg transition-all hover:scale-110 flex items-center justify-center group"
                >
                    <MessageCircle className="w-6 h-6 group-hover:hidden" />
                    <Sparkles className="w-6 h-6 hidden group-hover:block" />
                </button>
            )}

            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-20 left-4 right-4 sm:left-6 sm:right-auto sm:bottom-24 z-[9999] w-auto sm:w-[350px] h-[60vh] sm:h-[500px] bg-[#141414] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">

                    {/* Header */}
                    <div className="bg-[#1A1A1A] p-4 flex items-center justify-between border-b border-white/5">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[#2D9E49]/20 flex items-center justify-center">
                                <Bot className="w-5 h-5 text-[#2D9E49]" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white text-sm">Kartcade AI</h3>
                                <p className="text-[10px] text-white/50 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#2D9E49] animate-pulse"></span>
                                    Online
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="text-white/40 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Messages */}
                    {/* data-lenis-prevent attribute stops the smooth scroll library from hijacking scroll events here */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 overscroll-contain" data-lenis-prevent>
                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user'
                                        ? 'bg-[#2D9E49] text-white rounded-br-none'
                                        : 'bg-white/5 text-white/90 rounded-bl-none border border-white/5'
                                        }`}
                                >
                                    {msg.role === 'user' ? (
                                        msg.content
                                    ) : (
                                        <div className="prose prose-invert prose-sm max-w-none">
                                            {/* Render Markdown (Links become <a> tags) */}
                                            <ReactMarkdown
                                                components={{
                                                    a: ({ node, ...props }) => (
                                                        <a
                                                            {...props}
                                                            className="inline-block mt-2 px-4 py-2 bg-[#D42428] text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-[#B91C1C] transition-colors no-underline"
                                                        />
                                                    )
                                                }}
                                            >
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white/5 rounded-2xl rounded-bl-none px-4 py-3 border border-white/5">
                                    <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-4 bg-[#1A1A1A] border-t border-white/5">
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Ask about booking..."
                                className="w-full bg-black/50 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white focus:outline-none focus:border-[#2D9E49] transition-colors"
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[#2D9E49] hover:bg-[#2D9E49]/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Chatbot;
