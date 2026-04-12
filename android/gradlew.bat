@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "WRAPPER_JAR=%SCRIPT_DIR%gradle\wrapper\gradle-wrapper.jar"

if exist "%WRAPPER_JAR%" (
  java -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
  exit /b %errorlevel%
)

where gradle >nul 2>nul
if %errorlevel%==0 (
  gradle -p "%SCRIPT_DIR%" %*
  exit /b %errorlevel%
)

echo Gradle wrapper JAR is missing and 'gradle' is not installed.
echo Open ONLY the 'android' folder in Android Studio and let it regenerate wrapper files.
exit /b 1
