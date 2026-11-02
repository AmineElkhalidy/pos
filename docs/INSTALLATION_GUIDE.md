# Guide d'Installation & Première Connexion — Smart POS

## 1. Installation sous Windows (64-bit)

1. Exécutez l'installateur **`Smart POS Setup 1.0.0.exe`** situé dans le dossier `release/`.
2. Choisissez le répertoire d'installation (par défaut `C:\Users\<Utilisateur>\AppData\Local\Programs\Smart POS`).
3. L'installateur crée automatiquement :
   - Un raccourci **Smart POS** sur le Bureau Windows.
   - Une entrée **Smart POS** dans le Menu Démarrer.
   - Un désinstallateur officiel dans *Paramètres Windows → Applications installées*.

## 2. Emplacement des Données & Mises à Jour

Toutes les données commerciales sont stockées en dehors du dossier d'installation :
- **Base de données SQLite (WAL)** : `%APPDATA%\smart-pos\data\smartpos.sqlite`
- **Sauvegardes locales par défaut** : `%APPDATA%\smart-pos\backups\`

Lors d'une mise à jour de l'application ou d'une désinstallation standard (`deleteAppDataOnUninstall: false`), vos produits, ventes, clients et historiques sont intégralement préservés.

## 3. Identifiants Initiaux & Sécurité

Au premier lancement :
- **Nom d'utilisateur** : `admin`
- **Mot de passe initial** : `admin123`

> **IMPORTANT — Action immédiate obligatoire :**
> Dès votre première connexion, une bannière d'alerte et une fenêtre de sécurité s'affichent automatiquement pour vous inviter à **changer immédiatement le mot de passe administrateur** (`admin123` → nouveau mot de passe d'au moins 6 caractères).

## 4. Commandes de Développement (Code Source)

```powershell
# Installer les dépendances
npm install

# Lancer en mode développement avec rechargement à chaud
npm run dev

# Exécuter la suite de tests automatisés (Vitest sous runtime Electron)
npm test

# Vérifier le typage TypeScript et compiler le bundle de production
npm run build

# Générer l'installateur Windows (.exe) dans release/
npm run dist
```

