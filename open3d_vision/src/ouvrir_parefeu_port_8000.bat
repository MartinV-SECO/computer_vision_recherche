@echo off
REM Ouvre le port 8000 dans le pare-feu Windows pour l'acces depuis la tablette.
REM Executer en tant qu'administrateur : clic droit -> Executer en tant qu'administrateur
REM Inclut les profils Prive ET Public (sinon l'acces peut echouer si le reseau est en "Reseau public")
netsh advfirewall firewall delete rule name="Dessin vectoriel (port 8000)" >nul 2>&1
netsh advfirewall firewall add rule name="Dessin vectoriel (port 8000)" dir=in action=allow protocol=TCP localport=8000 profile=private,public
if %errorlevel% neq 0 (
  echo Erreur lors de l'ajout de la regle. Lancez en tant qu'administrateur.
) else (
  echo Regle ajoutee (profils Prive et Public). Redemarrer le serveur puis tester depuis la tablette.
)
echo.
echo Depuis la tablette : ouvrir le navigateur sur http://IP_DU_PC:8000
echo Si ca ne marche pas : Parametres Windows - Reseau - Proprietes de la connexion - passer en "Reseau prive".
pause
