import { Injectable, type Provider } from '@angular/core';
import { Feedback, type ConfirmRequest } from '../app/core/feedback';

/**
 * Replaces Kern's confirm()/toast() in tests: answers questions with `answer` and records what was asked and shown.
 * Use `provideFeedbackStub()` in the TestBed providers and `TestBed.inject(Feedback) as FeedbackStub` to inspect it.
 */
@Injectable()
export class FeedbackStub extends Feedback {
  answer = true;
  readonly questions: ConfirmRequest[] = [];
  readonly toasts: string[] = [];

  override confirm(request: ConfirmRequest): Promise<boolean> {
    this.questions.push(request);
    return Promise.resolve(this.answer);
  }

  override success(message: string): void {
    this.toasts.push(message);
  }
}

export function provideFeedbackStub(): Provider {
  return { provide: Feedback, useClass: FeedbackStub };
}
