# Guide de Sauvegarde & Restauration — Smart POS

## 1. Sécurité de la Base de Données SQLite
Smart POS utilise l'API de sauvegarde en ligne native de SQLite (`db.backup()`), garantissant une copie cohérente même lorsque le journal `WAL` est actif. Chaque sauvegarde fait immédiatement l'objet :
1. D'un calcul d'empreinte **SHA-256**.
2. D'un contrôle `PRAGMA integrity_check` en lecture seule.
3. D'une vérification de présence des tables critiques.

## 2. Sauvegarde Manuelle (Ordinateur Local & Clé USB)
Depuis **Paramètres → Sauvegarde & Restauration** :
- **Sauvegarder sur cet ordinateur** : crée une sauvegarde horodatée vérifiée dans `%APPDATA%\smart-pos\backups` (ou votre dossier personnalisé).
- **Sauvegarder sur clé USB** : détecte automatiquement les disques amovibles Windows (ex. `E:\SmartPOS-Backups`) et y enregistre une copie vérifiée.

## 3. Sauvegarde Automatique
- Par défaut, Smart POS effectue une sauvegarde automatique toutes les 24 heures ainsi qu'à la fermeture de l'application.
- La politique de rétention conserve les 30 dernières sauvegardes valides et **ne supprime jamais la dernière sauvegarde valide**.

## 4. Procédure de Restauration Sécurisée
1. Ouvrez **Paramètres → Sauvegarde & Restauration**.
2. Cliquez sur **Restaurer** en face d'une sauvegarde de l'historique ou cliquez sur **Choisir un fichier .sqlite à restaurer...**.
3. Smart POS vérifie d'abord l'intégrité du fichier choisi, crée automatiquement une **sauvegarde de sécurité pré-restauration (`smartpos-pre-restore-*.sqlite`)**, puis restaure les données de manière transactionnelle.

