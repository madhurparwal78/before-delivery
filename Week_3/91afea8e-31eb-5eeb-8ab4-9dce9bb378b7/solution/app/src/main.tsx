import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import { CartProvider } from "./lib/cart";
import { PincodeProvider } from "./lib/pincode";
import "./styles/global.css";

/** Every face the first screen paints with, `₹` included: the page is drawn once, in its own fonts, so nothing reflows when they arrive. */
const FIRST_PAINT_FONTS = ['900 1em "Darker Grotesque"', '400 1em Lexend', '500 1em Lexend', '700 1em Lexend', '900 1em Lexend'];
const fontsReady = Promise.all(FIRST_PAINT_FONTS.map((face) => document.fonts.load(face, "a ₹")));
const fontsLate = new Promise((resolve) => setTimeout(resolve, 1500));

void Promise.race([fontsReady, fontsLate]).then(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <BrowserRouter>
      <AuthProvider>
        <PincodeProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </PincodeProvider>
      </AuthProvider>
    </BrowserRouter>,
  );
});
