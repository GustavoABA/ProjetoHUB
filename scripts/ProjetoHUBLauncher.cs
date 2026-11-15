using System;
using System.Diagnostics;
using System.IO;

internal static class ProjetoHUBLauncher
{
    private static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, "node.exe");
        string script = Path.Combine(root, "scripts", "start-windows.ps1");
        if (!File.Exists(node) || !File.Exists(script))
        {
            Console.Error.WriteLine("Pacote ProjetoHUB incompleto: faltam node.exe ou scripts/start-windows.ps1.");
            return 1;
        }

        var start = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"");
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.EnvironmentVariables["PATH"] = root + Path.PathSeparator + start.EnvironmentVariables["PATH"];
        try
        {
            using (var process = Process.Start(start))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Falha ao abrir o ProjetoHUB: " + error.Message);
            return 1;
        }
    }
}
