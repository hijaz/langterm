#!/usr/bin/env node

import chalk from 'chalk';
import fetch from 'node-fetch';
import readline from 'readline';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_FILE = path.join(os.homedir(), '.langtermrc');
const OLLAMA_URL = 'http://localhost:11434';

class Langterm {
  constructor() {
    this.config = null;
    this.args = process.argv.slice(2);
    // Debug: Log raw arguments in development
    if (process.env.DEBUG) {
      console.log('Raw args:', this.args);
    }
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(CONFIG_FILE, 'utf8');
      this.config = JSON.parse(configData);
    } catch (error) {
      this.config = null;
    }
  }

  async saveConfig(config) {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    this.config = config;
  }

  async checkOllama() {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!response.ok) throw new Error('Ollama not responding');
      return true;
    } catch (error) {
      return false;
    }
  }

  async getModels() {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`);
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      return [];
    }
  }

  async prompt(question) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  async selectModel(models) {
    console.log(chalk.cyan('\nAvailable Ollama models:'));
    models.forEach((model, index) => {
      console.log(chalk.green(`${index + 1}. ${model.name}`));
    });

    while (true) {
      const choice = await this.prompt(chalk.yellow('\nSelect a model number: '));
      const index = parseInt(choice) - 1;
      
      if (index >= 0 && index < models.length) {
        return models[index].name;
      }
      console.log(chalk.red('Invalid selection. Please try again.'));
    }
  }

  async setup() {
    console.log(chalk.blue('🚀 Welcome to Langterm Setup!\n'));

    if (!await this.checkOllama()) {
      console.log(chalk.red('❌ Ollama is not running!'));
      console.log(chalk.yellow('\nPlease start Ollama first:'));
      console.log(chalk.gray('  1. Install from https://ollama.com'));
      console.log(chalk.gray('  2. Run: ollama serve'));
      console.log(chalk.gray('  3. Pull a model: ollama pull codestral:22b'));
      process.exit(1);
    }

    const models = await this.getModels();
    if (models.length === 0) {
      console.log(chalk.red('❌ No models found!'));
      console.log(chalk.yellow('\nPlease pull a model first:'));
      console.log(chalk.gray('  ollama pull codestral:22b'));
      console.log(chalk.gray('  or'));
      console.log(chalk.gray('  ollama pull deepseek-coder:6.7b'));
      process.exit(1);
    }

    const selectedModel = await this.selectModel(models);
    await this.saveConfig({ model: selectedModel });
    
    console.log(chalk.green(`\n✅ Setup complete! Using model: ${selectedModel}`));
    console.log(chalk.gray('\nYou can now use langterm:'));
    console.log(chalk.gray('  langterm "list all files larger than 100MB"'));
  }

  async generateCommand(userInput) {
    // Detect the operating system
    const platform = os.platform();
    let osContext = '';
    let exampleCommand = '';
    
    if (platform === 'win32') {
      osContext = 'Windows (Command Prompt/PowerShell)';
      exampleCommand = 'dir /a';
    } else if (platform === 'darwin') {
      osContext = 'macOS (Terminal)';
      exampleCommand = 'ls -la';
    } else {
      osContext = 'Linux (Terminal)';
      exampleCommand = 'ls -la';
    }

    const prompt = `You are an expert translator that converts English instructions into a single, executable terminal command for ${osContext}.

**RULES:**
1.  ONLY return the raw command appropriate for ${osContext}.
2.  Do NOT include any explanation or natural language.
3.  Do NOT include markdown formatting like \`\`\` or backticks (\`).
4.  Use platform-specific commands (e.g., 'dir' on Windows, 'ls' on Unix/Linux/macOS).

**EXAMPLE:**
Instruction: list all files
Response: ${exampleCommand}

**TASK:**
Instruction: ${userInput}
Response:`;

    try {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: prompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json();
      let command = data.response;

      // Clean up the response
      if (command.includes('`')) {
        command = command.match(/`([^`]*)`/)?.[1] || command;
      } else {
        command = command.replace(/```/g, '').trim();
      }

      return command;
    } catch (error) {
      throw new Error(`Failed to generate command: ${error.message}`);
    }
  }

  async executeCommand(command) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {
        shell: true,
        stdio: 'inherit'
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  async run() {
    // Parse command line arguments first
    const args = [...this.args];
    
    // Check for flags early and exit immediately
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--help' || arg === '-h') {
        this.showHelp();
        return;
      }
      
      if (arg === '--version' || arg === '-v') {
        console.log('langterm version 1.0.0');
        return;
      }
      
      if (arg === '--setup' || arg === '-s') {
        await this.setup();
        return;
      }
    }

    // Load config after checking for help/version/setup
    await this.loadConfig();

    // Check if model override is provided
    let modelOverride = null;
    let remainingArgs = [...args];
    const modelIndex = remainingArgs.findIndex(arg => arg === '--model' || arg === '-m');
    if (modelIndex !== -1 && remainingArgs[modelIndex + 1]) {
      modelOverride = remainingArgs[modelIndex + 1];
      remainingArgs.splice(modelIndex, 2); // Remove --model and its value
    }

    // First-time setup if no config exists
    if (!this.config && !modelOverride) {
      console.log(chalk.yellow('No configuration found. Running setup...\n'));
      await this.setup();
      console.log(chalk.gray('\n---\n'));
    }

    // Use model override if provided
    if (modelOverride) {
      this.config = { ...this.config, model: modelOverride };
    }

    // Check Ollama is running
    if (!await this.checkOllama()) {
      console.log(chalk.red('❌ Ollama is not running!'));
      console.log(chalk.yellow('Please start Ollama: ollama serve'));
      process.exit(1);
    }

    // Get user input from remaining args after removing flags
    let userInput;
    if (remainingArgs.length > 0) {
      userInput = remainingArgs.join(' ');
    } else {
      userInput = await this.prompt('Enter your command in English: ');
    }

    if (!userInput.trim()) {
      console.log(chalk.red('No input provided.'));
      process.exit(1);
    }

    // Generate command
    console.log(chalk.gray('Thinking...'));
    
    try {
      const command = await this.generateCommand(userInput);
      
      if (!command || command === 'null') {
        console.log(chalk.red('Failed to generate a command.'));
        process.exit(1);
      }

      console.log(chalk.green(`\nSuggested command: ${command}`));
      console.log(chalk.yellow('\nPress Enter to execute, Ctrl+C to cancel.'));
      
      const confirm = await this.prompt('');
      
      if (confirm === '') {
        console.log(chalk.gray(`Running: ${command}\n`));
        await this.executeCommand(command);
      } else {
        console.log(chalk.red('Cancelled.'));
      }
    } catch (error) {
      console.log(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  }

  showHelp() {
    console.log(chalk.blue('Langterm - Natural Language to Shell Commands\n'));
    console.log('Usage:');
    console.log('  langterm [options] [command in natural language]');
    console.log('\nOptions:');
    console.log('  --setup, -s     Configure Ollama model');
    console.log('  --model, -m     Override model for this run');
    console.log('  --help, -h      Show this help message');
    console.log('  --version, -v   Show version');
    console.log('\nExamples:');
    console.log('  langterm list all files larger than 100MB');
    console.log('  langterm --model codestral:22b find process on port 8080');
    console.log('  langterm --setup');
  }
}

// Main execution
const langterm = new Langterm();
langterm.run().catch(error => {
  console.error(chalk.red(`Error: ${error.message}`));
  process.exit(1);
});