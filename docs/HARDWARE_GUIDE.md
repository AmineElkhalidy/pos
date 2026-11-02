# Guide de Configuration Matérielle — Smart POS

## 1. Lecteur Code-Barres USB (Douchette)
- Branchez votre lecteur USB en mode **HID Clavier (Keyboard Wedge)** avec suffixe `Entrée (CR)`.
- Aucune configuration supplémentaire n'est requise : Smart POS détecte automatiquement la vitesse de frappe de la douchette sur l'écran Caisse, recherche le code dans SQLite, ajoute l'article au panier ou incrémente sa quantité.

## 2. Imprimante Ticket Thermique (58 mm / 80 mm)
Rendez-vous dans **Paramètres → Tickets & Imprimantes** :
1. Choisissez la largeur de papier : **80 mm** (standard) ou **58 mm**.
2. Choisissez le mode d'impression :
   - **Pilote d'imprimante Windows (`driver`)** : sélectionnez votre imprimante thermique installée dans Windows.
   - **ESC/POS Réseau (`escpos-network`)** : indiquez l'adresse IP de l'imprimante (ex. `192.168.1.100`) et le port (`9100`).
   - **ESC/POS Port Série (`escpos-serial`)** : sélectionnez le port COM et le débit en bauds.
   - **Export PDF (`pdf`)** : idéal pour tester ou archiver les tickets sans imprimante matérielle.

## 3. Imprimante d'Étiquettes Codes-Barres
Rendez-vous dans **Paramètres → Étiquettes** et **Codes-barres & Étiquettes** :
- Configurez la largeur et la hauteur de vos rouleaux d'étiquettes en millimètres (par défaut `50 mm × 30 mm`).
- Utilisez l'aperçu intégré pour vérifier le rendu du nom FR/AR, du code-barres EAN-13/Code128 et du prix en DH avant d'imprimer ou d'exporter en PDF.

## 4. Balance Électronique (RS-232 / USB-Série)
Rendez-vous dans **Paramètres → Balance Électronique** :
1. Sélectionnez le protocole correspondant à votre balance :
   - **CAS (ER-JR / PR-II / SW-1)**
   - **Mettler-Toledo SICS (SI)**
   - **Generic ASCII**
   - **Balance simulée** (pour tester sans matériel ; clairement identifiée par le badge `SIMULÉE` / `محاكاة`).
2. Sélectionnez le port COM (ex. `COM3`), la vitesse (`9600` bauds par défaut) et cliquez sur **Tester la connexion balance**.

