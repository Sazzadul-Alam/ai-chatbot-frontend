import { Component, EventEmitter, Output, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Challenge {
  target: string;
  correct: number[];
  images: string[];
}

@Component({
  selector: 'app-recaptcha-challenge',
  imports: [CommonModule],
  templateUrl: './recaptcha-challenge.html',
  styleUrl: './recaptcha-challenge.css',
})
export class RecaptchaChallengeComponent implements OnInit {
  @Output() verified = new EventEmitter<void>();
  @Output() closed   = new EventEmitter<void>();

  challenges: Challenge[] = [
    {
      target: 'traffic light',
      correct: [0, 3, 7],
      images: [
        'assets/captcha/traffic-light-1.jpg',
        'assets/captcha/street-1.jpg',
        'assets/captcha/car-1.jpg',
        'assets/captcha/traffic-light-2.jpg',
        'assets/captcha/building-1.jpg',
        'assets/captcha/tree-1.jpg',
        'assets/captcha/bus-1.jpg',
        'assets/captcha/traffic-light-3.jpg',
        'assets/captcha/sign-1.jpg',
      ]
    },
    {
      target: 'bicycle',
      correct: [1, 4, 6],
      images: [
        'assets/captcha/car-2.jpg',
        'assets/captcha/bicycle-1.jpg',
        'assets/captcha/street-2.jpg',
        'assets/captcha/building-2.jpg',
        'assets/captcha/bicycle-2.jpg',
        'assets/captcha/tree-2.jpg',
        'assets/captcha/bicycle-3.jpg',
        'assets/captcha/sign-2.jpg',
        'assets/captcha/bus-2.jpg',
      ]
    },
    {
      target: 'bus',
      correct: [2, 5, 8],
      images: [
        'assets/captcha/car-3.jpg',
        'assets/captcha/tree-3.jpg',
        'assets/captcha/bus-1.jpg',
        'assets/captcha/bicycle-4.jpg',
        'assets/captcha/street-3.jpg',
        'assets/captcha/bus-2.jpg',
        'assets/captcha/building-3.jpg',
        'assets/captcha/sign-3.jpg',
        'assets/captcha/bus-3.jpg',
      ]
    },
    {
      target: 'crosswalk',
      correct: [0, 2, 6],
      images: [
        'assets/captcha/crosswalk-1.jpg',
        'assets/captcha/car-4.jpg',
        'assets/captcha/crosswalk-2.jpg',
        'assets/captcha/tree-4.jpg',
        'assets/captcha/building-4.jpg',
        'assets/captcha/bus-4.jpg',
        'assets/captcha/crosswalk-3.jpg',
        'assets/captcha/bicycle-5.jpg',
        'assets/captcha/street-4.jpg',
      ]
    },
  ];

  currentIndex = 0;
  selected     = new Set<number>();
  tiles        = Array.from({ length: 9 }, (_, i) => i);
  errorMsg     = '';

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.shuffleChallenges();
    this.currentIndex = Math.floor(Math.random() * this.challenges.length);
  }

  private shuffleChallenges(): void {
    for (let i = this.challenges.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.challenges[i], this.challenges[j]] = [this.challenges[j], this.challenges[i]];
    }
  }

  get challenge(): Challenge {
    return this.challenges[this.currentIndex];
  }

  isSelected(index: number): boolean {
    return this.selected.has(index);
  }

  toggleTile(index: number): void {
    // Reassign to new Set so Angular detects the change
    const next = new Set(this.selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    this.selected = next;
  }

  get selectedCount(): number {
    return this.selected.size;
  }

  refresh(): void {
    // Pick a random index different from the current one
    let next: number;
    do {
      next = Math.floor(Math.random() * this.challenges.length);
    } while (next === this.currentIndex && this.challenges.length > 1);

    this.currentIndex = next;
    this.selected     = new Set<number>(); // ← reassign, not .clear()
    this.errorMsg     = '';
    this.cdr.detectChanges();
  }

  verify(): void {
    const { correct } = this.challenge;
    const isCorrect =
      correct.every(i => this.selected.has(i)) &&
      this.selected.size === correct.length;

    if (!isCorrect) {
      this.errorMsg = 'Incorrect selection. Please try again.';
      setTimeout(() => {
        this.refresh();
        this.errorMsg = '';
        this.cdr.detectChanges();
      }, 800);
      return;
    }
    this.verified.emit();
  }

  close(): void {
    this.closed.emit();
  }
}
