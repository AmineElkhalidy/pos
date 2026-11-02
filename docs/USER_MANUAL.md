# Manuel d'Utilisation — Smart POS (Français / العربية)

## 1. Connexion & Langue (تسجيل الدخول واللغة)
- Connectez-vous avec votre compte **ADMIN** ou **CASHIER**.
- Basculez à tout moment entre **Français (LTR)** et **العربية (RTL)** depuis le bouton en haut à droite sans perdre le panier de vente en cours.

## 2. Session de Caisse (حصة الصندوق)
1. Avant d'encaisser, ouvrez une session de caisse depuis **Caisse / POS → Ouvrir la caisse** en saisissant le fond de caisse initial en Dirhams (DH).
2. En fin de journée ou de service, cliquez sur **Clôturer la caisse**, saisissez le montant d'espèces réellement compté : Smart POS calcule automatiquement l'écart et génère un **Rapport de Clôture imprimable / PDF**.
3. Un caissier ne peut pas clôturer la session d'un autre caissier.

## 3. Point de Vente — Caisse (نقطة البيع)
- **Raccourcis clavier** :
  - `F2` : Focus sur la barre de scan / recherche
  - `F9` : Valider la vente rapidement
  - `F10` : Valider la vente et afficher/imprimer le ticket thermique
  - `Échap (Esc)` : Vider le panier en cours
- **Vente au poids ou au volume** (ex. *350 g de زعتر / thym*, *250 ml d'huile d'olive*, *1.5 kg de miel*) :
  - Cliquez sur le produit ou scannez son code-barres : la fenêtre de pesée s'ouvre.
  - Choisissez l'unité de saisie (`g` ou `kg`, `ml` ou `L`) ou cliquez sur **Lire la balance**.
  - Le prix et la déduction de stock sont convertis automatiquement avec une précision au millième.
- **Modes de règlement** :
  - Espèces (avec calcul automatique de la monnaie rendue), Carte, Chèque, Virement.
  - **Paiement multiple / partiel** : cliquez sur *Paiement multiple / partiel* pour répartir le montant entre plusieurs moyens de paiement.
  - **Vente à crédit (الكريدي)** : sélectionnez un client enregistré et saisissez l'acompte payé (ou `0` pour un crédit total). Le reste à payer est automatiquement ajouté à la dette du client (dans la limite de son plafond de crédit).

## 4. Produits, Codes-barres & Étiquettes (المنتجات والباركود)
- Créez vos produits avec nom Français, nom Arabe, SKU, catégorie, unité (`pc`, `kg`, `g`, `L`, `ml`, `pack`, `box`), prix d'achat, prix de vente, prix minimum et seuil d'alerte stock.
- Si un produit local (miel, épices, huile, vrac) n'a pas de code-barres fabricant, cliquez sur **Générer EAN-13 interne** (préfixe magasin `21`) ou **Code 128 interne**.
- Depuis **Codes-barres & Étiquettes**, ajoutez vos articles à la file d'impression, réglez les dimensions en millimètres (ex. `50 × 30 mm`), prévisualisez et imprimez ou exportez en PDF.

## 5. Stock, Achats & Inventaire (المخزون والمشتريات)
- Chaque réception d'achat fournisseur augmente le stock, met à jour le coût moyen pondéré (CMUP) et enregistre un mouvement `PURCHASE`.
- Les pertes (`DAMAGE`), péremptions (`EXPIRATION`) et ajustements (`ADJUSTMENT`) sont tracés dans l'historique avec l'utilisateur et la date.
- L'onglet **Comptage d'inventaire** permet de saisir le stock physique compté et d'appliquer automatiquement les écarts (`INVENTORY`).

## 6. Clients, Crédits & Dépenses (الزبناء والديون والمصاريف)
- Consultez la liste des clients débiteurs dans **Crédits clients**, encaissez des règlements partiels ou totaux, imprimez le **Reçu de règlement** et consultez le **Relevé de compte** chronologique.
- Enregistrez vos charges quotidiennes (électricité, eau, loyer, transport, maintenance) dans **Dépenses** pour obtenir votre bénéfice net réel dans **Rapports & Analyses**.

